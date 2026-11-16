"use client";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path?: string; row?: number; message: string }[];
}

export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; error: ApiErrorBody; status: number };

/** JSON fetch helper for same-origin API routes; never throws for HTTP errors. */
export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      headers: init.form ? undefined : init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: "same-origin",
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, data: json as T, status: res.status };
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}&expired=1`;
    }
    const error = (json as { error?: ApiErrorBody } | null)?.error ?? {
      code: "HTTP_ERROR",
      message: res.status === 403 ? "You do not have permission to perform this action." : `Request failed (HTTP ${res.status}).`,
    };
    return { ok: false, error, status: res.status };
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "The server could not be reached. Check your connection and try again." }, status: 0 };
  }
}

/** Maps API validation details onto form field names (last path segment). */
export function fieldErrors(error: ApiErrorBody | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of error?.details ?? []) {
    const key = d.path?.split(".").pop();
    if (key && !out[key]) out[key] = d.message;
  }
  return out;
}
