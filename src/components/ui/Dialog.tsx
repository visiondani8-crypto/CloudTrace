"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

/**
 * Accessible modal built on the native <dialog> element: showModal() makes
 * the background inert and contains focus, Escape closes it, and focus is
 * returned to the element that opened it.
 */
function useNativeDialog(open: boolean, onClose: () => void, confirmClose?: () => boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!confirmClose || confirmClose()) onClose();
    };
    const onClosed = () => {
      const target = returnFocus.current;
      if (target && document.contains(target)) target.focus();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClosed);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClosed);
    };
  }, [onClose, confirmClose]);

  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "wide";
  /** When true, closing asks for confirmation so typed input is not lost silently. */
  dirty?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const confirmClose = () => !dirty || window.confirm("Discard unsaved changes?");
  const ref = useNativeDialog(open, onClose, confirmClose);
  return (
    <dialog
      ref={ref}
      className="ct-dialog"
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget && confirmClose()) onClose();
      }}
    >
      {open && (
        <>
          <div className="ct-dialog-head">
            <div>
              <h2 id={titleId} className="ct-section-title text-fg-strong">
                {title}
              </h2>
              {description && (
                <p id={descId} className="ct-support mt-1">
                  {description}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" aria-label="Close dialog" onClick={() => confirmClose() && onClose()} icon={<X />} />
          </div>
          <div className="ct-dialog-body">{children}</div>
          {footer && <div className="ct-dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useNativeDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      className="ct-drawer"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ct-dialog-head">
            <div className="min-w-0">
              <h2 id={titleId} className="ct-section-title text-fg-strong">
                {title}
              </h2>
              {subtitle && <div className="ct-support mt-1">{subtitle}</div>}
            </div>
            <Button variant="ghost" size="sm" aria-label="Close panel" onClick={onClose} icon={<X />} />
          </div>
          <div className="ct-drawer-body">{children}</div>
          {footer && <div className="ct-dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  children,
  confirmLabel,
  busy,
  danger,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} loadingLabel="Working…">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-5 text-fg">{children}</div>
    </Dialog>
  );
}
