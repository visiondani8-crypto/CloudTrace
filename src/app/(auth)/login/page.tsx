import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api") || value.startsWith("/login")) return "/overview";
  return value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (await getAuthContext()) redirect(returnTo);
  const isDemo = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_SEED === "true";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-base px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="ct-brand-mark" aria-hidden="true">CT</span>
          <span className="ct-brand-wordmark">CloudTrace</span>
          <span className="ct-product-caption">Security operations</span>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="text-[19px] font-[650] leading-[26px] tracking-[-0.3px] text-fg-strong">Sign in to CloudTrace</h1>
          <p className="ct-support mt-1 mb-5">Use your authorised workspace credentials.</p>
          <LoginForm returnTo={returnTo} expired={params.expired === "1"} />
        </div>
        <p className="ct-support mt-4">Understand the failure. Trace the evidence. Protect the business.</p>
        {isDemo && (
          <p className="ct-support mt-2">
            Local demonstration environment. Demo accounts are created by <span className="ct-mono">npm run db:seed</span> using the
            password set in your local <span className="ct-mono">.env</span>.
          </p>
        )}
      </div>
    </main>
  );
}
