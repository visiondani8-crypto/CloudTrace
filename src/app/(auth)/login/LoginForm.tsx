"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/primitives";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({ returnTo, expired }: { returnTo: string; expired: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setBusy(true);
    try {
      const res = await signIn("credentials", { email: email.trim(), password, redirect: false });
      if (!res || res.error) {
        setError(
          res?.error === "RATE_LIMITED"
            ? "Too many sign-in attempts. Wait a few minutes and try again."
            : "Email or password is incorrect, or the account has no workspace access.",
        );
        setBusy(false);
        return;
      }
      window.location.assign(returnTo);
    } catch {
      setError("The sign-in service is unavailable. Try again shortly.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {expired && !error && <Banner tone="warning">Your session expired. Sign in again to continue.</Banner>}
      {error && (
        <div role="alert">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <div>
        <label htmlFor="email" className="ct-field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          className="ct-field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          required
        />
        {emailError && (
          <p id="email-error" className="ct-field-error" role="alert">
            {emailError}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="password" className="ct-field-label">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            className="ct-field pr-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-2 hover:text-fg"
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <Button type="submit" variant="primary" loading={busy} loadingLabel="Signing in…" className="w-full">
        Sign in
      </Button>
    </form>
  );
}
