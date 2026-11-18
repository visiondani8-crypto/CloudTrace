import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Job } from "./types";

/** Subscribe to server-sent job events and keep queries fresh. */
export function useJobEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("job", (ev) => {
        const job = JSON.parse((ev as MessageEvent).data) as Job;
        qc.setQueryData(["job", job.id], job);
        qc.setQueryData<Job[]>(["jobs"], (old) => {
          if (!old) return old;
          const i = old.findIndex((j) => j.id === job.id);
          if (i === -1) return [job, ...old];
          const n = old.slice();
          n[i] = job;
          return n;
        });
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          if (job.project_id) {
            qc.invalidateQueries({ queryKey: ["project", job.project_id] });
            qc.invalidateQueries({ queryKey: ["highlights", job.project_id] });
            qc.invalidateQueries({ queryKey: ["edits", job.project_id] });
          }
          qc.invalidateQueries({ queryKey: ["renders"] });
          qc.invalidateQueries({ queryKey: ["social"] });
          qc.invalidateQueries({ queryKey: ["projects"] });
        }
      });
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [qc]);
}
