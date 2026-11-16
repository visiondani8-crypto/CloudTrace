export const dynamic = "force-dynamic";

/** Print-only routes: no navigation shell. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="ct-print-root">{children}</div>;
}
