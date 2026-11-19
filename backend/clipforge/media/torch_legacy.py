"""Read tensors from a legacy (pre-1.6, non-zip) PyTorch checkpoint without PyTorch.

Only plain data is reconstructed: dicts/OrderedDicts of float/int tensors. The unpickler
refuses every global except the handful that legacy checkpoints use to describe tensors and
storages, so a checkpoint cannot execute code while being read.

Layout written by ``torch.save(..., _use_new_zipfile_serialization=False)``:
  pickle(magic) · pickle(protocol) · pickle(sys_info) · pickle(object, storages as persistent ids)
  · pickle([storage keys]) · for each key: int64 element count + raw little-endian data
"""

from __future__ import annotations

import collections
import pickle
import struct
from pathlib import Path
from typing import Any, BinaryIO

import numpy as np

MAGIC = 0x1950A86A20F9469CFC6C
_DTYPES = {
    "FloatStorage": np.float32, "DoubleStorage": np.float64, "HalfStorage": np.float16,
    "LongStorage": np.int64, "IntStorage": np.int32, "ShortStorage": np.int16, "CharStorage": np.int8,
    "ByteStorage": np.uint8, "BoolStorage": np.bool_,
}


class _StorageType:
    def __init__(self, name: str):
        self.name = name
        self.dtype = np.dtype(_DTYPES[name])


class _Storage:
    def __init__(self, key: str, stype: _StorageType, size: int):
        self.key, self.dtype, self.size = key, stype.dtype, size
        self.data: np.ndarray | None = None


class _Tensor:
    def __init__(self, storage: _Storage, offset: int, size: tuple, stride: tuple):
        self.storage, self.offset, self.size, self.stride = storage, offset, tuple(size), tuple(stride)

    def numpy(self) -> np.ndarray:
        base = self.storage.data
        assert base is not None
        if not self.size:
            return np.array(base[self.offset])
        item = base.itemsize
        view = np.lib.stride_tricks.as_strided(base[self.offset:], shape=self.size, strides=[s * item for s in self.stride])
        return np.array(view)  # own the memory


def _rebuild_tensor_v2(storage, offset, size, stride, requires_grad=False, hooks=None, *extra):
    return _Tensor(storage, offset, size, stride)


def _rebuild_tensor(storage, offset, size, stride):
    return _Tensor(storage, offset, size, stride)


def _rebuild_parameter(data, requires_grad=False, hooks=None, *extra):
    return data


_ALLOWED = {
    ("collections", "OrderedDict"): collections.OrderedDict,
    ("torch._utils", "_rebuild_tensor_v2"): _rebuild_tensor_v2,
    ("torch._utils", "_rebuild_tensor"): _rebuild_tensor,
    ("torch._utils", "_rebuild_parameter"): _rebuild_parameter,
}


class _Unpickler(pickle.Unpickler):
    def __init__(self, fh: BinaryIO, storages: dict[str, _Storage]):
        super().__init__(fh)
        self.storages = storages

    def find_class(self, module: str, name: str):
        if module == "torch" and name in _DTYPES:
            return _StorageType(name)
        fn = _ALLOWED.get((module, name))
        if fn is None:
            raise pickle.UnpicklingError(f"Refusing to load {module}.{name} from checkpoint")
        return fn

    def persistent_load(self, pid):
        kind, stype, key, _location, size, *view = pid
        if kind != "storage" or view and view[0] is not None:
            raise pickle.UnpicklingError("Unsupported storage reference")
        if key not in self.storages:
            self.storages[key] = _Storage(key, stype, size)
        return self.storages[key]


def _resolve(obj: Any) -> Any:
    if isinstance(obj, _Tensor):
        return obj.numpy()
    if isinstance(obj, dict):
        return type(obj)((k, _resolve(v)) for k, v in obj.items())
    if isinstance(obj, (list, tuple)):
        return type(obj)(_resolve(v) for v in obj)
    return obj


class _Restricted(pickle.Unpickler):
    def find_class(self, module, name):  # the header pickles hold plain data only
        raise pickle.UnpicklingError(f"Unexpected global {module}.{name} in checkpoint header")


def load_legacy_checkpoint(path: Path) -> Any:
    """Return the checkpoint object with every tensor as a numpy array."""
    with open(path, "rb") as fh:
        if fh.read(2) == b"PK":
            raise ValueError("This is a zip-format PyTorch checkpoint, not a legacy one")
        fh.seek(0)
        if _Restricted(fh).load() != MAGIC:
            raise ValueError("Not a legacy PyTorch checkpoint")
        if _Restricted(fh).load() != 1001:
            raise ValueError("Unsupported checkpoint protocol")
        sys_info = _Restricted(fh).load()
        if not sys_info.get("little_endian", True):
            raise ValueError("Big-endian checkpoints are not supported")
        storages: dict[str, _Storage] = {}
        obj = _Unpickler(fh, storages).load()
        keys = _Restricted(fh).load()
        for key in keys:
            st = storages[key]
            (n,) = struct.unpack("<q", fh.read(8))
            raw = fh.read(n * st.dtype.itemsize)
            if len(raw) != n * st.dtype.itemsize:
                raise ValueError("Checkpoint is truncated")
            st.data = np.frombuffer(raw, dtype=st.dtype.newbyteorder("<"))
    return _resolve(obj)

