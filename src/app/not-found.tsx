import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-base px-4">
      <div className="ct-panel w-full max-w-[440px] p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="ct-brand-mark" aria-hidden="true">CT</span>
          <span className="ct-brand-wordmark">CloudTrace</span>
        </div>
        <h1 className="ct-title">Page not found</h1>
        <p className="ct-support mt-2">
          The page does not exist, or the record is not available in your workspace.
        </p>
        <Link prefetch={false} href="/overview" className="ct-btn mt-5" data-variant="primary">
          Return to overview
        </Link>
      </div>
    </main>
  );
}
