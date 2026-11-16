"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ct-page">
      <h1 className="ct-title mb-4">Something went wrong</h1>
      <ErrorState
        message={`This information could not be loaded. Try again.${error.digest ? ` Request reference: ${error.digest}` : ""}`}
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => reset()}>
              Retry
            </Button>
            <Link prefetch={false} className="ct-btn" data-size="sm" href="/overview">
              Return to overview
            </Link>
          </div>
        }
      />
    </div>
  );
}
