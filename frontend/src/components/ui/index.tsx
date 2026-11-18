import * as React from "react";
import * as DialogP from "@radix-ui/react-dialog";
import * as SliderP from "@radix-ui/react-slider";
import * as SwitchP from "@radix-ui/react-switch";
import * as TabsP from "@radix-ui/react-tabs";
import * as TooltipP from "@radix-ui/react-tooltip";
import { Check, Copy, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

// ----------------------------------------------------------------------------- Button
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "xs" | "sm" | "md" | "lg"; loading?: boolean; icon?: React.ReactNode }
>(({ className, variant = "secondary", size = "md", loading, icon, children, disabled, ...p }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none whitespace-nowrap",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
      "disabled:opacity-45 disabled:pointer-events-none",
      size === "xs" && "h-6 px-2 text-2xs",
      size === "sm" && "h-7 px-2.5 text-xs",
      size === "md" && "h-8 px-3 text-[13px]",
      size === "lg" && "h-10 px-4 text-sm",
      variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
      variant === "secondary" && "bg-raised text-fg hover:bg-[#283043] border border-line",
      variant === "outline" && "border border-line text-fg hover:bg-raised",
      variant === "ghost" && "text-sub hover:text-fg hover:bg-raised",
      variant === "danger" && "bg-err/15 text-err hover:bg-err/25 border border-err/30",
      className,
    )}
    {...p}
  >
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    {children}
  </button>
));
Button.displayName = "Button";

export function IconButton({ label, className, children, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-raised hover:text-fg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40 disabled:pointer-events-none",
          active && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
          className,
        )}
        {...p}
      >
        {children}
      </button>
    </Tip>
  );
}

// ----------------------------------------------------------------------------- Card & layout
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface", className)} {...p} />;
}
export function CardHeader({ title, sub, action, className }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-3.5 pb-2", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-sub">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", className, children }: { tone?: "neutral" | "accent" | "ok" | "warn" | "err"; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium",
        tone === "neutral" && "bg-raised text-sub border border-line",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "err" && "bg-err/15 text-err",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 80 ? "ok" : score >= 60 ? "accent" : score >= 45 ? "warn" : "err";
  return (
    <Badge tone={tone as any} className="tabular-nums text-xs px-2">
      {score.toFixed(0)}
      <span className="opacity-60">/100</span>
    </Badge>
  );
}

// ----------------------------------------------------------------------------- inputs
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-fg placeholder:text-muted",
      "focus:outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/40 disabled:opacity-50",
      className,
    )}
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-fg placeholder:text-muted leading-relaxed",
      "focus:outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/40",
      className,
    )}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export function NativeSelect({ value, onChange, options, className, ...p }: {
  value: string | number;
  onChange: (v: string) => void;
  options: { value: string | number; label: string; disabled?: boolean }[];
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full appearance-none rounded-md border border-line px-2.5 pr-7 text-[13px] text-fg disabled:opacity-50",
        "focus:outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/40",
        className,
      )}
      style={{
        backgroundColor: "#0B0E14",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
        backgroundSize: "12px",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239AA6B8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...p}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, children, className, right }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center justify-between text-xs font-medium text-sub">
        <span>{label}</span>
        {right}
      </span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-muted">{hint}</span>}
    </label>
  );
}

export function Slider({ value, min, max, step = 0.01, onChange, className, label, format }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  label?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="w-24 shrink-0 text-xs text-sub">{label}</span>}
      <SliderP.Root
        className="relative flex h-4 flex-1 touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      >
        <SliderP.Track className="relative h-1 flex-1 rounded-full bg-raised">
          <SliderP.Range className="absolute h-full rounded-full bg-accent" />
        </SliderP.Track>
        <SliderP.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-fg shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
      </SliderP.Root>
      <span className="w-12 shrink-0 text-right text-2xs tabular-nums text-sub">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 text-[13px] text-fg", disabled && "opacity-50")}>
      {label && <span>{label}</span>}
      <SwitchP.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative h-[18px] w-8 shrink-0 rounded-full bg-line transition-colors data-[state=checked]:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <SwitchP.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[15px]" />
      </SwitchP.Root>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-md border border-line bg-bg p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            size === "sm" ? "h-6 text-2xs" : "h-7 text-xs",
            value === o.value ? "bg-raised text-fg shadow-sm" : "text-sub hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-sub">
      <span className="relative h-6 w-6 overflow-hidden rounded border border-line" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label} />
      </span>
      {label && <span className="flex-1">{label}</span>}
      <span className="font-mono text-2xs text-muted">{value}</span>
    </label>
  );
}

// ----------------------------------------------------------------------------- feedback
export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "ok" | "warn" | "err" }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-raised", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", tone === "accent" && "bg-accent", tone === "ok" && "bg-ok", tone === "warn" && "bg-warn", tone === "err" && "bg-err")}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-sub", className)} />;
}

export function EmptyState({ icon, title, sub, action }: { icon?: React.ReactNode; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-1 text-muted">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {sub && <p className="max-w-md text-xs text-sub">{sub}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "warn", title, children, action }: { tone?: "warn" | "err" | "ok" | "accent"; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs",
        tone === "warn" && "border-warn/30 bg-warn/10 text-warn",
        tone === "err" && "border-err/30 bg-err/10 text-err",
        tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
        tone === "accent" && "border-accent/30 bg-accent/10 text-accent",
      )}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="mt-0.5 text-fg/80">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", size = "xs" }: { text: string; label?: string; size?: "xs" | "sm" }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      size={size}
      variant="ghost"
      aria-label={`${label} to clipboard`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      icon={done ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

// ----------------------------------------------------------------------------- overlays
export function Tip({ label, children, side = "top" }: { label: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipP.Root delayDuration={350}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content side={side} sideOffset={6} className="z-50 rounded-md border border-line bg-raised px-2 py-1 text-2xs text-fg shadow-panel">
          {label}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <DialogP.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-panel focus:outline-none",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <DialogP.Title className="font-display text-base font-semibold">{title}</DialogP.Title>
              {description && <DialogP.Description className="mt-1 text-xs text-sub">{description}</DialogP.Description>}
            </div>
            <DialogP.Close className="rounded p-1 text-sub hover:bg-raised hover:text-fg" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogP.Close>
          </div>
          {children}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export const Tabs = TabsP.Root;
export function TabList({ className, ...p }: TabsP.TabsListProps) {
  return <TabsP.List className={cn("flex gap-0.5 border-b border-line", className)} {...p} />;
}
export function Tab({ className, ...p }: TabsP.TabsTriggerProps) {
  return (
    <TabsP.Trigger
      className={cn(
        "relative px-2.5 py-2 text-xs font-medium text-sub transition-colors hover:text-fg data-[state=active]:text-fg",
        "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full data-[state=active]:after:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      {...p}
    />
  );
}
export const TabPanel = TabsP.Content;

// ----------------------------------------------------------------------------- toasts
type Toast = { id: number; tone: "ok" | "err" | "warn" | "accent"; text: string };
const ToastCtx = React.createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "err" ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[92vw] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-lg border bg-surface px-3 py-2.5 text-[13px] shadow-panel",
              t.tone === "ok" && "border-ok/40",
              t.tone === "err" && "border-err/40 text-err",
              t.tone === "warn" && "border-warn/40",
              t.tone === "accent" && "border-accent/40",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
