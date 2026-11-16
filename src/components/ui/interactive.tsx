"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, MoreHorizontal } from "lucide-react";
import { Button } from "./Button";
import { useToast } from "./Toast";

export function CopyButton({ value, label = "Copy", successMessage = "Copied to clipboard.", size = "sm" }: { value: string; label?: string; successMessage?: string; size?: "sm" | "md" }) {
  const notify = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      icon={done ? <Check /> : <Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          notify(successMessage);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          notify("Clipboard access was blocked by the browser. Select and copy the text manually.", "warning");
        }
      }}
    >
      {label}
    </Button>
  );
}

/** ARIA tabs with arrow-key navigation. Selection is controlled (URL-backed by callers). */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const t = tabs[next];
      refs.current[t.value]?.focus();
      onChange(t.value);
    }
  };
  return (
    <div className="ct-tablist" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[t.value] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.value}`}
          aria-controls={`panel-${t.value}`}
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          className="ct-tab"
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-1.5 font-mono text-[11px] text-fg-2">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Small disclosure menu: Escape closes and returns focus, arrow keys move between items. */
export function Menu({ label, children, align = "right", trigger }: { label: string; children: (close: () => void) => ReactNode; align?: "left" | "right"; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    const first = wrap.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div className="relative" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="ct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? undefined : label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? (
          <>
            <MoreHorizontal size={15} aria-hidden="true" /> More
          </>
        )}
      </button>
      {open && (
        <div role="menu" aria-label={label} className={`ct-popover mt-1 ${align === "right" ? "right-0" : "left-0"}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onSelect, href, icon }: { children: ReactNode; onSelect?: () => void; href?: string; icon?: ReactNode }) {
  if (href) {
    return (
      <a role="menuitem" tabIndex={-1} className="ct-menu-item" href={href}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" tabIndex={-1} type="button" className="ct-menu-item" onClick={onSelect}>
      {icon}
      {children}
    </button>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
