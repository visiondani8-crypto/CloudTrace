import "server-only";
import { getAiConfig } from "@/lib/config";

/** Non-secret view of the AI configuration, safe to pass to client components. */
export function getAiConfigPublic(): { configured: boolean; model: string | null } {
  const ai = getAiConfig();
  return { configured: ai.configured, model: ai.configured ? ai.model : null };
}
