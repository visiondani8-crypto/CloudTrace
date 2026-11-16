import { AppShell } from "@/components/shell/AppShell";
import { requirePageContext } from "@/lib/auth/context";
import { formatUtc } from "@/lib/domain/time";
import { getIntegrationStatus } from "@/lib/services/integrations";
import type { Tone } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const status = await getIntegrationStatus(ctx);
  const ms = status.microsoft;

  // Truthful source indicator: never claims a live connection without a recorded sync.
  let source: { label: string; tone: Tone; environment: "DEMO" | "CONNECTED TENANT" } = {
    label: "Local data",
    tone: "warning",
    environment: "DEMO",
  };
  let footer = "No live tenant connected. Public reports and simulated telemetry only.";
  if (ms.status === "READY") {
    source = { label: "Microsoft 365 · Ready (not synced)", tone: "info", environment: "DEMO" };
    footer = "Microsoft 365 connector configured; no sync recorded yet.";
  } else if (ms.status === "CONNECTED" && ms.lastSyncAt) {
    source = { label: `Microsoft 365 · Last sync ${formatUtc(ms.lastSyncAt).slice(11)}`, tone: "success", environment: "CONNECTED TENANT" };
    footer = "Service-health data from an authorised tenant. Other records may still be simulated.";
  } else if (ms.status === "ERROR") {
    source = { label: "Microsoft 365 · Sync error", tone: "danger", environment: "DEMO" };
    footer = "Last Microsoft 365 sync failed; existing data preserved.";
  } else if (ms.status === "SYNCING") {
    source = { label: "Microsoft 365 · Syncing", tone: "info", environment: "DEMO" };
  }

  return (
    <AppShell
      user={{ name: ctx.userName, email: ctx.userEmail, role: ctx.role }}
      organization={{ id: ctx.organizationId, name: ctx.organizationName }}
      memberships={ctx.memberships.map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName, role: m.role }))}
      source={source}
      footer={footer}
    >
      {children}
    </AppShell>
  );
}
