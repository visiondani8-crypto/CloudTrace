"""Language-model provider adapters with schema-validated JSON output.

* ``local``     – no language model; deterministic analysis/generation only.
* ``ollama``    – a locally running Ollama server (private, offline).
* ``anthropic`` – Claude via the official SDK. Requires an API key supplied in
  Settings *and* explicit cloud consent, because transcripts leave the machine.

Every response is parsed as JSON and validated with a Pydantic model; invalid
output is rejected and retried once with the validation error, then the caller
falls back to deterministic results. Nothing unvalidated is ever stored.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..db import session_scope
from ..models import UsageRecord
from .secrets import get_secret

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5"
# USD per million tokens (input, output). Estimates only; check current pricing.
ANTHROPIC_PRICING = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-fable-5-2": (8.0, 40.0),
}


class ProviderError(Exception):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


@dataclass
class Usage:
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class Provider:
    name = "local"
    is_cloud = False

    def status(self) -> dict[str, Any]:
        return {"available": True, "reason": None}

    def generate_json(self, system: str, prompt: str, schema: type[T], purpose: str, max_tokens: int = 4000) -> tuple[T, Usage]:
        raise ProviderError("The local provider does not run a language model.")


class LocalProvider(Provider):
    name = "local"


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "qwen2.5:7b-instruct", timeout: float = 240.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def status(self) -> dict[str, Any]:
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=2.5)
            r.raise_for_status()
            names = [m.get("name") for m in r.json().get("models", [])]
            if self.model not in names and not any(n.split(":")[0] == self.model.split(":")[0] for n in names):
                return {"available": False, "reason": f"Model '{self.model}' is not pulled. Run: ollama pull {self.model}", "models": names}
            return {"available": True, "reason": None, "models": names}
        except Exception:
            return {"available": False, "reason": "Ollama is not running at " + self.base_url + ". Install from ollama.com and start it."}

    def generate_json(self, system: str, prompt: str, schema: type[T], purpose: str, max_tokens: int = 4000) -> tuple[T, Usage]:
        js = schema.model_json_schema()
        messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
        last_err = None
        for _attempt in range(2):
            try:
                r = httpx.post(
                    f"{self.base_url}/api/chat",
                    json={"model": self.model, "messages": messages, "stream": False, "format": js,
                          "options": {"temperature": 0.2, "num_predict": max_tokens}},
                    timeout=self.timeout,
                )
                r.raise_for_status()
            except httpx.HTTPError as e:
                raise ProviderError(f"Ollama request failed: {e}", "Check that Ollama is running and the model is pulled.") from e
            data = r.json()
            text = (data.get("message") or {}).get("content", "")
            usage = Usage("ollama", self.model, int(data.get("prompt_eval_count") or 0), int(data.get("eval_count") or 0))
            try:
                return schema.model_validate_json(text), usage
            except ValidationError as e:
                last_err = e
                messages += [{"role": "assistant", "content": text},
                             {"role": "user", "content": f"That JSON did not validate: {str(e)[:800]}. Return corrected JSON only."}]
        raise ProviderError(f"Ollama returned invalid structured output: {str(last_err)[:300]}")


class AnthropicProvider(Provider):
    name = "anthropic"
    is_cloud = True

    def __init__(self, model: str = ANTHROPIC_DEFAULT_MODEL, effort: str = "medium"):
        self.model = model
        self.effort = effort

    def _client(self):
        key = get_secret("anthropic_api_key")
        if not key:
            raise ProviderError("No Anthropic API key configured.", "Add your key in Settings → AI providers. A Claude subscription does not include API access.")
        try:
            import anthropic
        except ImportError as e:  # pragma: no cover
            raise ProviderError("The anthropic package is not installed.") from e
        return anthropic, anthropic.Anthropic(api_key=key, max_retries=2, timeout=300.0)

    def status(self) -> dict[str, Any]:
        if not get_secret("anthropic_api_key"):
            return {"available": False, "reason": "No API key configured (Settings → AI providers)."}
        return {"available": True, "reason": None, "model": self.model}

    def verify_key(self) -> dict[str, Any]:
        anthropic, client = self._client()
        try:
            m = client.models.retrieve(self.model)
            return {"ok": True, "model": m.id}
        except anthropic.AuthenticationError:
            return {"ok": False, "error": "Invalid API key."}
        except anthropic.NotFoundError:
            return {"ok": False, "error": f"Model {self.model} is not available to this key."}
        except anthropic.APIConnectionError:
            return {"ok": False, "error": "Could not reach the Anthropic API (offline?)."}
        except anthropic.APIStatusError as e:
            return {"ok": False, "error": f"API error {e.status_code}"}

    def generate_json(self, system: str, prompt: str, schema: type[T], purpose: str, max_tokens: int = 8000) -> tuple[T, Usage]:
        anthropic, client = self._client()
        js = _strict_schema(schema.model_json_schema())
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        usage = Usage("anthropic", self.model)
        last_err: Exception | None = None
        for _attempt in range(2):
            base = dict(
                model=self.model, max_tokens=max_tokens, system=system, messages=messages,
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": js}},
            )
            try:
                try:
                    # Server-side refusal fallback (routes a declined request to a fallback model).
                    resp = client.beta.messages.create(**base, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
                except anthropic.BadRequestError as e:
                    if "fallback" not in str(e).lower():
                        raise
                    resp = client.messages.create(**base)
            except anthropic.AuthenticationError as e:
                raise ProviderError("The Anthropic API key was rejected.", "Update the key in Settings → AI providers.") from e
            except anthropic.RateLimitError as e:
                raise ProviderError("Anthropic rate limit reached.", "Wait a minute and retry, or use the local provider.") from e
            except anthropic.APIConnectionError as e:
                raise ProviderError("Could not reach the Anthropic API.", "Check your connection; local analysis still works offline.") from e
            except anthropic.APIStatusError as e:
                raise ProviderError(f"Anthropic API error {e.status_code}.", str(e)[:200]) from e
            u = getattr(resp, "usage", None)
            usage.input_tokens += int(getattr(u, "input_tokens", 0) or 0)
            usage.output_tokens += int(getattr(u, "output_tokens", 0) or 0)
            if resp.stop_reason == "refusal":
                raise ProviderError("The model declined this request.", "Results fall back to local analysis.")
            if resp.stop_reason == "max_tokens":
                last_err = ProviderError("Response truncated (max_tokens).")
                break
            text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
            try:
                parsed = schema.model_validate_json(text)
                _record(usage, purpose)
                return parsed, usage
            except ValidationError as e:
                last_err = e
                messages = messages + [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"Validation failed: {str(e)[:800]}. Return corrected JSON."},
                ]
        _record(usage, purpose)
        raise ProviderError(f"Invalid structured output from Claude: {str(last_err)[:300]}")


def _strict_schema(js: dict[str, Any]) -> dict[str, Any]:
    """Inline $defs and set additionalProperties=false for strict JSON schema output."""
    defs = js.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            out = {k: resolve(v) for k, v in node.items() if k not in ("title", "default")}
            if out.get("type") == "object":
                out["additionalProperties"] = False
                out["required"] = list(out.get("properties", {}).keys())
            return out
        if isinstance(node, list):
            return [resolve(x) for x in node]
        return node

    return resolve(js)


def _record(u: Usage, purpose: str) -> None:
    price = ANTHROPIC_PRICING.get(u.model)
    if price:
        u.cost_usd = (u.input_tokens * price[0] + u.output_tokens * price[1]) / 1e6
    try:
        with session_scope() as s:
            s.add(UsageRecord(provider=u.provider, model=u.model, purpose=purpose, input_tokens=u.input_tokens,
                              output_tokens=u.output_tokens, estimated_cost_usd=round(u.cost_usd, 6)))
            s.commit()
    except Exception:  # pragma: no cover
        log.exception("Could not record usage")


def get_provider(name: str, settings: dict[str, Any]) -> Provider:
    """Construct a provider. Cloud providers require explicit consent."""
    ai = settings.get("ai", {}) if settings else {}
    if name == "ollama":
        return OllamaProvider(ai.get("ollama_url", "http://127.0.0.1:11434"), ai.get("ollama_model", "qwen2.5:7b-instruct"))
    if name == "anthropic":
        if not ai.get("cloud_consent"):
            raise ProviderError(
                "Cloud processing is not enabled.",
                "Enable “Allow sending transcripts to cloud AI” in Settings → Privacy to use Anthropic. Media files are never uploaded.",
            )
        return AnthropicProvider(ai.get("anthropic_model", ANTHROPIC_DEFAULT_MODEL), ai.get("anthropic_effort", "medium"))
    return LocalProvider()


def now_ms() -> int:
    return int(time.time() * 1000)


def dumps(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False)
