"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type ToastTone = "success" | "danger" | "warning" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<{ notify: (message: string, tone?: ToastTone) => void } | null>(null);

/** Compact corner notifications (max 3). Errors stay until dismissed or 10s. Never replaces inline validation. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const notify = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = next.current++;
      setItems((list) => [...list.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "danger" ? 10_000 : 4_500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ct-toast-region" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className="ct-toast" data-tone={t.tone} role={t.tone === "danger" ? "alert" : "status"}>
            <span className="flex-1">{t.message}</span>
            <button type="button" className="text-current opacity-80 hover:opacity-100" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx.notify;
}
