"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "recovery") setError("Your reset link is invalid or expired. Request a new link and open it in this browser.");
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError("");
    if (email.trim().toLowerCase().endsWith("@staff.sublime.invalid")) { setError("This account uses an employee login ID. Ask your admin to reset its password in Employees."); return; }
    setBusy(true);
    try {
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", "/reset-password");
      const { error: cause } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo.toString() });
      if (cause) throw cause;
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request a reset link. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <BrandLogo/><h1>Forgot password?</h1>
    <p>Enter the email address used for your employee account.</p>
    {error && <p className="login-error" role="alert">{error}</p>}
    {sent ? <p role="status">If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder. Open the link in this browser to continue.</p> : <><label htmlFor="reset-email">Email address<input id="reset-email" type="email" autoComplete="email" autoCapitalize="none" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)}/></label><button className="primary-button" disabled={busy || !supabaseConfigured}>{busy ? "Sending…" : "Send reset link"}</button></>}
    <small>Using an employee login ID without an email? Ask your admin to reset your password in Employees → Edit employee → New password.</small>
    <Link href="/login">Back to sign in</Link>
  </form></main>;
}
