"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { PasswordField } from "@/components/ui/password-field";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: { user }, error: cause } = await createClient().auth.getUser();
        if (cause || !user) throw new Error("Your reset link is invalid or expired. Request a new link and open it in the browser where you requested it.");
        if (active) setReady(true);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not verify your reset link."); }
      finally { if (active) setChecking(false); }
    })();
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !ready) return;
    setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: cause } = await createClient().auth.updateUser({ password });
      if (cause) throw cause;
      setPassword(""); setConfirmation(""); setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update your password. Request a new reset link if it has expired."); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <BrandLogo/><h1>Set a new password</h1>
    {error && <p className="login-error" role="alert">{error}</p>}
    {checking ? <p role="status">Checking your reset link…</p> : done ? <><p role="status">Your password has been updated. Use the new password the next time you sign in.</p><Link href="/dashboard">Open workspace</Link></> : ready ? <><PasswordField label="New password" required minLength={8} autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)}/><PasswordField label="Confirm new password" required minLength={8} autoComplete="new-password" disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)}/><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button></> : <Link href="/forgot-password">Request a new reset link</Link>}
  </form></main>;
}
