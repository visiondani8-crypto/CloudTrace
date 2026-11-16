"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./primitives";

interface FieldShellProps {
  label: string;
  required?: boolean;
  help?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Visible label, help text and accessible error message for one form control. */
export function FieldShell({ label, required, help, error, children, className }: FieldShellProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="ct-field-label">
        {label}
        {required && (
          <span className="text-red" aria-hidden="true">
            {" "}
            *
          </span>
        )}
        {required && <span className="ct-sr-only"> (required)</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {help && !error && (
        <p id={helpId} className="ct-field-help">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="ct-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Common = { label: string; help?: ReactNode; error?: string; required?: boolean; className?: string };

export function TextField({ label, help, error, required, className, mono, ...rest }: Common & InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <FieldShell label={label} help={help} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="ct-field"
          data-mono={mono || undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function TextareaField({ label, help, error, required, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} help={help} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} className="ct-field" aria-describedby={describedBy} aria-invalid={invalid || undefined} required={required} {...rest} />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  help,
  error,
  required,
  className,
  options,
  placeholder,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <FieldShell label={label} help={help} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="ct-field" aria-describedby={describedBy} aria-invalid={invalid || undefined} required={required} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/** Date-time entry interpreted as UTC (the label says so explicitly). */
export function UtcDateTimeField({ label, help, error, required, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell
      label={`${label} (UTC)`}
      help={help ?? "Enter the time in UTC. Stored as an ISO-8601 timestamp."}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="datetime-local"
          className="ct-field"
          data-mono="true"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

/** Accessible checkbox list (e.g. evidence selection). */
export function CheckboxList({
  legend,
  items,
  selected,
  onChange,
  emptyText,
  help,
  error,
}: {
  legend: string;
  items: { value: string; label: ReactNode; disabled?: boolean }[];
  selected: string[];
  onChange: (values: string[]) => void;
  emptyText?: string;
  help?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}>
      <legend className="ct-field-label">{legend}</legend>
      {items.length === 0 ? (
        <p className="ct-field-help">{emptyText ?? "Nothing to select."}</p>
      ) : (
        <div className={cx("max-h-48 overflow-y-auto rounded-[5px] border border-line-strong bg-raised p-1", error && "border-red")}>
          {items.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[12.5px] hover:bg-hover">
              <input
                type="checkbox"
                className="ct-checkbox mt-0.5"
                checked={selected.includes(item.value)}
                disabled={item.disabled}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, item.value] : selected.filter((v) => v !== item.value))
                }
              />
              <span className="min-w-0">{item.label}</span>
            </label>
          ))}
        </div>
      )}
      {help && !error && (
        <p id={`${id}-help`} className="ct-field-help">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="ct-field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="ct-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
