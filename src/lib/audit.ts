import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { redactSecrets } from "@/lib/config";
import type { Tx } from "@/lib/db";

const SENSITIVE_KEY = /secret|token|password|passwd|authorization|api[-_]?key|cookie|credential/i;

/** Removes sensitive keys and secret values from audit metadata (recursively, bounded). */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return redactSecrets(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactMetadata(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redactMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Append-only audit write. Call inside the same transaction as the mutation it records. */
export async function writeAudit(tx: Tx, ctx: Pick<AuthContext, "organizationId" | "userId" | "userName">, input: AuditInput) {
  return tx.auditEntry.create({
    data: {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorLabel: ctx.userName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary.slice(0, 500),
      metadataJson: JSON.stringify(redactMetadata(input.metadata ?? {})),
    },
  });
}
