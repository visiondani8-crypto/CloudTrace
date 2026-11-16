import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="ct-page">
      <div className="ct-panel max-w-[560px] p-6">
        <h1 className="ct-title">Page not found</h1>
        <p className="ct-support mt-2">
          This page or record does not exist in your current workspace. Records that belong to other organisations are never shown.
        </p>
        <div className="mt-5 flex gap-2">
          <Link prefetch={false} href="/overview" className="ct-btn" data-variant="primary">
            Return to overview
          </Link>
          <Link prefetch={false} href="/incidents" className="ct-btn">
            View incidents
          </Link>
        </div>
      </div>
    </div>
  );
}
