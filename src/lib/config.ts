import "server-only";

/**
 * Server-only configuration. Secret values are never returned to the client,
 * logged, or written to the database; only booleans and non-secret identifiers
 * leave this module.
 */

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,80}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getAuthSecret(): string {
  const secret = env("AUTH_SECRET") || env("NEXTAUTH_SECRET");
  if (!secret || secret.startsWith("replace-with")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is not set to a unique value. Refusing to start in production.");
    }
  }
  return secret || "cloudtrace-insecure-development-secret-change-me";
}

export interface AiConfig {
  configured: boolean;
  apiKey: string;
  model: string;
  /** Non-secret description of the configuration problem, if any. */
  problem: string | null;
}

export function getAiConfig(): AiConfig {
  const apiKey = env("ANTHROPIC_API_KEY");
  const requested = env("CLAUDE_MODEL");
  const model = requested || DEFAULT_CLAUDE_MODEL;
  if (!apiKey) return { configured: false, apiKey: "", model, problem: "ANTHROPIC_API_KEY is not set." };
  if (!MODEL_ID.test(model)) {
    return { configured: false, apiKey: "", model, problem: "CLAUDE_MODEL is not a valid model identifier." };
  }
  return { configured: true, apiKey, model, problem: null };
}

export interface MicrosoftConfig {
  credentialsPresent: boolean;
  configured: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  organizationSlug: string;
  problems: string[];
}

export function getMicrosoftConfig(): MicrosoftConfig {
  const tenantId = env("MS_TENANT_ID");
  const clientId = env("MS_CLIENT_ID");
  const clientSecret = env("MS_CLIENT_SECRET");
  const organizationSlug = env("MS_CONNECTOR_ORGANIZATION_SLUG");
  const problems: string[] = [];
  if (!tenantId) problems.push("MS_TENANT_ID is not set.");
  else if (!GUID.test(tenantId) && !TENANT_DOMAIN.test(tenantId)) problems.push("MS_TENANT_ID must be a GUID or tenant domain.");
  if (!clientId) problems.push("MS_CLIENT_ID is not set.");
  else if (!GUID.test(clientId)) problems.push("MS_CLIENT_ID must be a GUID.");
  if (!clientSecret) problems.push("MS_CLIENT_SECRET is not set.");
  if (!organizationSlug) problems.push("MS_CONNECTOR_ORGANIZATION_SLUG is not set (the connector serves one explicitly selected workspace).");
  const credentialsPresent = !!(tenantId || clientId || clientSecret);
  return {
    credentialsPresent,
    configured: problems.length === 0,
    tenantId,
    clientId,
    clientSecret,
    organizationSlug,
    problems,
  };
}

export function demoUserCreationAllowed(): boolean {
  const flag = env("ALLOW_DEMO_USER_CREATION").toLowerCase();
  if (process.env.NODE_ENV === "production") return flag === "true";
  return flag !== "false";
}

/** Replaces any configured secret value in a string before it is logged or stored. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const name of ["ANTHROPIC_API_KEY", "MS_CLIENT_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET", "DEMO_SEED_PASSWORD"]) {
    const value = env(name);
    if (value.length >= 6) out = out.split(value).join("[REDACTED]");
  }
  return out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[REDACTED]");
}
