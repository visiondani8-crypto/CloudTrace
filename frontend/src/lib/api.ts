// Thin typed client for the local ClipForge backend.

export class ApiError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

const HEADERS = { "X-ClipForge-Client": "1" };

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    let hint: string | undefined;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join("; ") : msg;
      hint = j.hint ?? undefined;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 0 || res.status === 502 || res.status === 504) {
      msg = "The ClipForge backend is not reachable. Start it with ./clipforge.sh";
    }
    throw new ApiError(res.status, msg, hint);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

export async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString()
    : "";
  try {
    return await handle<T>(await fetch(`/api${path}${qs}`));
  } catch (e) {
    if (e instanceof TypeError) throw new ApiError(0, "The ClipForge backend is not reachable. Start it with ./clipforge.sh");
    throw e;
  }
}

async function send<T>(method: string, path: string, body?: unknown, raw?: BodyInit, contentType?: string): Promise<T> {
  const headers: Record<string, string> = { ...HEADERS };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (contentType) headers["Content-Type"] = contentType;
  try {
    return await handle<T>(await fetch(`/api${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }));
  } catch (e) {
    if (e instanceof TypeError) throw new ApiError(0, "The ClipForge backend is not reachable. Start it with ./clipforge.sh");
    throw e;
  }
}

export const post = <T>(path: string, body?: unknown) => send<T>("POST", path, body ?? {});
export const put = <T>(path: string, body?: unknown) => send<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => send<T>("PATCH", path, body);
export const del = <T>(path: string) => send<T>("DELETE", path);
export const postText = <T>(path: string, text: string) => send<T>("POST", path, undefined, text, "text/plain");

/** Streaming upload with progress (XHR exposes upload progress; fetch does not). */
export function uploadFile<T>(path: string, file: File, onProgress: (p: number) => void): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("PUT", `/api${path}`);
    xhr.setRequestHeader("X-ClipForge-Client", "1");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data?.detail ?? xhr.statusText, data?.hint));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed — is the backend running?"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.hint ? `${e.message} — ${e.hint}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
