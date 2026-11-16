import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./primitives";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
}

/** Button with explicit loading state: disables repeat submission and keeps its width. */
export function Button({ variant = "secondary", size = "md", loading, loadingLabel, icon, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("ct-btn", className)}
      data-variant={variant === "secondary" ? undefined : variant}
      data-size={size === "sm" ? "sm" : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon}
      {loading ? (loadingLabel ?? "Saving…") : children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  download,
  external,
  prefetch = false,
}: {
  href: string;
  variant?: Variant;
  size?: "md" | "sm";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  download?: boolean;
  external?: boolean;
  prefetch?: boolean;
}) {
  const props = {
    className: cx("ct-btn", className),
    "data-variant": variant === "secondary" ? undefined : variant,
    "data-size": size === "sm" ? "sm" : undefined,
  };
  if (download || external) {
    return (
      <a href={href} {...props} {...(download ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={prefetch} {...props}>
      {icon}
      {children}
    </Link>
  );
}
