import "server-only";
import type { MicrosoftConfig } from "@/lib/config";

/**
 * Minimal read-only Microsoft Graph client for tenant service health
 * (application permission ServiceHealth.Read.All, admin-consented).
 * Tokens stay in server memory, are cached until shortly before expiry and are
 * never logged or persisted.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 5;

export class GraphError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export function clearGraphTokenCache() {
  tokenCache = null;
}

type FetchLike = typeof fetch;

async function getToken(config: MicrosoftConfig, fetchImpl: FetchLike): Promise<string> {
  const key = `${config.tenantId}:${config.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  let res: Response;
  try {
    res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GraphError("TOKEN_UNREACHABLE", "Could not reach the Microsoft identity platform.");
  }
  if (!res.ok) {
    throw new GraphError(
      res.status === 400 || res.status === 401 ? "TOKEN_REJECTED" : `TOKEN_HTTP_${res.status}`,
      "The Microsoft identity platform rejected the app credentials. Check tenant ID, client ID, secret and admin consent.",
    );
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GraphError("TOKEN_INVALID", "Token response did not contain an access token.");
  tokenCache = { key, token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

async function graphGet<T>(url: string, token: string, fetchImpl: FetchLike, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GraphError("GRAPH_UNREACHABLE", "Could not reach Microsoft Graph.");
  }
  if (res.status === 429 && !retried) {
    const retryAfter = Math.min(10, Number.parseInt(res.headers.get("retry-after") ?? "2", 10) || 2);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return graphGet<T>(url, token, fetchImpl, true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new GraphError("GRAPH_FORBIDDEN", "Microsoft Graph denied access. Confirm ServiceHealth.Read.All is granted with admin consent.");
  }
  if (res.status === 429) throw new GraphError("GRAPH_THROTTLED", "Microsoft Graph throttled the request. Try again later.");
  if (!res.ok) throw new GraphError(`GRAPH_HTTP_${res.status}`, `Microsoft Graph returned HTTP ${res.status}.`);
  return (await res.json()) as T;
}

async function getAll<T>(path: string, token: string, fetchImpl: FetchLike): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = `${GRAPH}${path}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data: { value?: T[]; "@odata.nextLink"?: string } = await graphGet(url, token, fetchImpl);
    items.push(...(data.value ?? []));
    const next = data["@odata.nextLink"];
    // Only follow pagination links that stay on Microsoft Graph.
    url = next && next.startsWith(`${GRAPH}/`) ? next : null;
  }
  return items;
}

export interface ServiceHealthIssue {
  id: string;
  title?: string;
  service?: string;
  status?: string;
  classification?: string;
  impactDescription?: string;
  startDateTime?: string;
  endDateTime?: string | null;
  lastModifiedDateTime?: string;
  isResolved?: boolean;
}

export interface ServiceHealthOverview {
  id: string;
  service?: string;
  status?: string;
}

export async function fetchServiceHealth(config: MicrosoftConfig, fetchImpl: FetchLike = fetch) {
  const token = await getToken(config, fetchImpl);
  const select = "id,title,service,status,classification,impactDescription,startDateTime,endDateTime,lastModifiedDateTime,isResolved";
  const [overviews, issues] = await Promise.all([
    getAll<ServiceHealthOverview>("/admin/serviceAnnouncement/healthOverviews?$select=id,service,status", token, fetchImpl),
    getAll<ServiceHealthIssue>(`/admin/serviceAnnouncement/issues?$select=${select}&$top=100`, token, fetchImpl),
  ]);
  return { overviews, issues };
}
