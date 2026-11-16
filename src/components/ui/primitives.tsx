import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, Inbox, Lock } from "lucide-react";
import {
  CLASSIFICATION_LABELS,
  CONFIDENCE_LABELS,
  CRITICALITY_LABELS,
  HYPOTHESIS_CONFIDENCE_LABELS,
  HYPOTHESIS_STATUS_LABELS,
  IMPACT_LABELS,
  PROVENANCE_LABELS,
  PROVIDER_REPORTED_LABEL,
  SEVERITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  labelOf,
  type Tone,
} from "@/lib/ui/labels";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Tag({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={cx("ct-tag", className)} data-tone={tone === "neutral" ? undefined : tone} title={title}>
      {children}
    </span>
  );
}

export const SeverityBadge = ({ value }: { value: string }) => {
  const l = labelOf(SEVERITY_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const LifecycleBadge = ({ value }: { value: string }) => {
  const l = labelOf(STATUS_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const ClassificationBadge = ({ value }: { value: string }) => {
  const l = labelOf(CLASSIFICATION_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const ProvenanceBadge = ({ value }: { value: string }) => {
  const l = PROVENANCE_LABELS[value as keyof typeof PROVENANCE_LABELS] ?? { label: value, tone: "neutral" as Tone, description: "" };
  return (
    <Tag tone={l.tone} title={l.description}>
      {l.label}
    </Tag>
  );
};
export const ImpactBadge = ({ state, providerReported }: { state: string; providerReported?: boolean }) => {
  const l = providerReported ? PROVIDER_REPORTED_LABEL : labelOf(IMPACT_LABELS, state);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const ConfidenceBadge = ({ value }: { value: string }) => {
  const l = labelOf(CONFIDENCE_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const CriticalityBadge = ({ value }: { value: string }) => {
  const l = labelOf(CRITICALITY_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const HypothesisStatusBadge = ({ value }: { value: string }) => {
  const l = labelOf(HYPOTHESIS_STATUS_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const HypothesisConfidenceBadge = ({ value }: { value: string }) => {
  const l = labelOf(HYPOTHESIS_CONFIDENCE_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const TaskStatusBadge = ({ value }: { value: string }) => {
  const l = labelOf(TASK_STATUS_LABELS, value);
  return <Tag tone={l.tone}>{l.label}</Tag>;
};
export const TaskPriorityBadge = ({ value }: { value: string }) => {
  const l = labelOf(TASK_PRIORITY_LABELS, value);
  return <Tag tone={l.tone}>{l.label} priority</Tag>;
};

/** Case data-mode label, e.g. PUBLIC REPORT + SIMULATED. */
export function DataModeBadge({ label }: { label: string | null }) {
  if (!label) return null;
  const tone: Tone = /SIMULATED|SYNTHETIC/.test(label) ? "warning" : "info";
  return <Tag tone={tone}>{label}</Tag>;
}

export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("ct-mono", className)} title={title}>
      {children}
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className={cx("ct-panel", className)} aria-labelledby={id && title ? `${id}-title` : undefined} id={id}>
      {(title || actions) && (
        <div className="ct-panel-head flex-wrap">
          <div className="min-w-0">
            {title && (
              <h2 className="ct-panel-title" id={id ? `${id}-title` : undefined}>
                {title}
              </h2>
            )}
            {description && <p className="ct-support mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className={cx("ct-panel-body", bodyClassName)}>{children}</div>}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  caption,
  href,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="ct-metric-label">{label}</div>
      <div className="ct-metric-value">{value}</div>
      {caption && <div className="ct-metric-caption">{caption}</div>}
    </>
  );
  if (href) {
    return (
      <Link prefetch={false} href={href} className="ct-metric block no-underline transition-colors hover:border-line-strong hover:bg-raised">
        {body}
      </Link>
    );
  }
  return <div className="ct-metric">{body}</div>;
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ct-empty">
      <div className="mx-auto flex h-8 w-8 items-center justify-center text-fg-2" aria-hidden="true">
        {icon ?? <Inbox size={22} strokeWidth={1.5} />}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, action }: { message?: string; action?: ReactNode }) {
  return (
    <div className="ct-banner flex items-start gap-2" data-tone="danger" role="alert">
      <AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden="true" />
      <div className="flex-1">
        {message ?? "This information could not be loaded. Try again."}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Banner({ tone, children, icon }: { tone?: "warning" | "danger" | "info"; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ct-banner flex items-start gap-2" data-tone={tone === "info" ? undefined : tone}>
      {icon && (
        <span className="mt-0.5 flex-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ReadOnlyNotice() {
  return (
    <Banner icon={<Lock size={14} />}>
      Your role allows viewing, not editing. You have read-only access to this workspace.
    </Banner>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  crumbs,
  eyebrow,
  title,
  subtitle,
  chips,
  actions,
}: {
  crumbs?: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="ct-breadcrumb flex-wrap">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="inline-flex items-center gap-2">
              {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
              {c.href ? (
                <Link prefetch={false} href={c.href} className="text-fg-2 no-underline hover:text-fg hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-fg">
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="ct-page-header mb-0">
        <div className="ct-page-header-copy">
          {eyebrow && <div className="ct-eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="ct-title">{title}</h1>
          {subtitle && <p className="ct-support mt-1.5 max-w-[85ch]">{subtitle}</p>}
          {chips && <div className="mt-3 flex flex-wrap items-center gap-1.5">{chips}</div>}
        </div>
        {actions && <div className="ct-page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("ct-skeleton", className)} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="ct-page" aria-busy="true" aria-live="polite">
      <span className="ct-sr-only">Loading…</span>
      <Skeleton className="mb-4 h-3 w-40" />
      <Skeleton className="mb-3 h-7 w-80" />
      <Skeleton className="mb-8 h-3 w-96 max-w-full" />
      <div className="ct-metrics">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.7px] text-fg-2">{children}</div>;
}
