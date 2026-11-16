"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Mono, Panel } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { formatUtc } from "@/lib/domain/time";

export function NotesPanel({ incidentId, notes, canEdit }: { incidentId: string; notes: { id: string; text: string; authorName: string; createdAt: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const notify = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!text.trim()) {
      setError("Note is required.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const res = await api(`/api/incidents/${incidentId}/notes`, { body: { text } });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setText("");
    notify("Note saved.");
    router.refresh();
  }

  return (
    <Panel id="notes" title="Analyst notes" description="Explain why events might be connected. Notes are attributed and audited.">
      {canEdit && (
        <div className="mb-4">
          <TextareaField label="New note" value={text} onChange={(e) => setText(e.target.value)} error={error} maxLength={5000} />
          <Button className="mt-2" size="sm" variant="primary" loading={busy} onClick={save}>
            Add note
          </Button>
        </div>
      )}
      {notes.length === 0 ? (
        <p className="ct-support">No analyst notes recorded.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-line-strong pl-3">
              <p className="whitespace-pre-wrap text-[13px] leading-5">{n.text}</p>
              <p className="mt-1 text-[11.5px] text-fg-2">
                {n.authorName} · <Mono>{formatUtc(n.createdAt)}</Mono>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
