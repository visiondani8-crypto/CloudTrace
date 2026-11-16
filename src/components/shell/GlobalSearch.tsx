"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Network, Search, Siren } from "lucide-react";
import { useDebounced } from "@/components/ui/interactive";
import { api } from "@/lib/client/api";

interface Results {
  incidents: { id: string; caseNumber: string; title: string; status: string }[];
  assets: { id: string; name: string; provider: string }[];
  evidence: { id: string; ref: string; title: string; incidentId: string; provenance: string }[];
}

interface Option {
  key: string;
  group: string;
  label: string;
  meta: string;
  href: string;
  icon: typeof Search;
}

/** Workspace-scoped search over incidents, assets and evidence. Shortcut: "/" or Ctrl/Cmd+K. */
export function GlobalSearch({ variant = "inline", onNavigate }: { variant?: "inline" | "overlay"; onNavigate?: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const debounced = useDebounced(q, 250);

  useEffect(() => {
    if (variant === "overlay") {
      input.current?.focus();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<Results>(`/api/search?q=${encodeURIComponent(debounced.trim())}`).then((res) => {
      if (cancelled) return;
      setLoading(false);
      setFailed(!res.ok);
      setResults(res.ok ? res.data : null);
      setActive(0);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const options: Option[] = useMemo(() => {
    if (!results) return [];
    return [
      ...results.incidents.map((i) => ({
        key: `i-${i.id}`,
        group: "Incidents",
        label: `${i.caseNumber} · ${i.title}`,
        meta: i.status.toLowerCase(),
        href: `/investigations/${i.id}`,
        icon: Siren,
      })),
      ...results.assets.map((a) => ({
        key: `a-${a.id}`,
        group: "Assets",
        label: a.name,
        meta: a.provider.replace("_", " ").toLowerCase(),
        href: `/assets?asset=${a.id}`,
        icon: Network,
      })),
      ...results.evidence.map((e) => ({
        key: `e-${e.id}`,
        group: "Evidence",
        label: `${e.ref} · ${e.title}`,
        meta: e.provenance === "SYNTHETIC" ? "simulated" : e.provenance.replace("_", " ").toLowerCase(),
        href: `/investigations/${e.incidentId}?tab=evidence&evidence=${e.id}`,
        icon: Archive,
      })),
    ];
  }, [results]);

  const go = (opt: Option) => {
    setOpen(false);
    setQ("");
    onNavigate?.();
    router.push(opt.href);
  };
  const overlay = variant === "overlay";

  return (
    <div className={overlay ? "relative" : "relative hidden md:block"}>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-2" aria-hidden="true" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open && q.length >= 2}
          aria-controls="ct-search-results"
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `opt-${options[active].key}` : undefined}
          aria-label="Search incidents, assets and evidence"
          placeholder="Search cases, assets, evidence  /"
          className={overlay ? "ct-field pl-8" : "ct-field min-h-[34px] w-[220px] py-1.5 pl-8 text-[12.5px] lg:w-[280px]"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => !overlay && window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && options[active]) {
              e.preventDefault();
              go(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div id="ct-search-results" role="listbox" aria-label="Search results" className={overlay ? "mt-2" : "ct-popover right-0 mt-1 w-[360px]"}>
          {loading && !results && <div className="px-2.5 py-2 text-[12px] text-fg-2">Searching…</div>}
          {failed && <div className="px-2.5 py-2 text-[12px] text-red">Search failed. Try again.</div>}
          {results && options.length === 0 && <div className="px-2.5 py-2 text-[12px] text-fg-2">No matches in this workspace.</div>}
          {options.map((opt, i) => {
            const Icon = opt.icon;
            const showGroup = i === 0 || options[i - 1].group !== opt.group;
            return (
              <div key={opt.key}>
                {showGroup && <div className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.6px] text-fg-2">{opt.group}</div>}
                <div
                  id={`opt-${opt.key}`}
                  role="option"
                  aria-selected={i === active}
                  className="ct-menu-item cursor-pointer"
                  data-active={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(opt);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <Icon aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  <span className="text-[11px] text-fg-2">{opt.meta}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
