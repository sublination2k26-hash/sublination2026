"use client";

import { PasswordField } from "@/components/ui/password-field";

import { BrandLogo } from "@/components/ui/brand-logo";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";
import { Sparkles } from "lucide-react";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      router.replace("/dashboard"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not set password."); }
    finally { setBusy(false); }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <BrandLogo/><div className="section-kicker">EMPLOYEE ACCOUNT</div><h1>Set your password</h1><p>Choose a password to finish setting up your Subli-nation Printing System sign-in.</p>
    {error && <div className="login-error" role="alert">{error}</div>}
    <PasswordField label="Password" required minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/>
    <PasswordField label="Confirm password" required minLength={8} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)}/>
    <button className="primary-button" type="submit" disabled={!supabaseConfigured || busy}>{busy ? "Saving…" : "Save password"}</button>
  </form></main>;
}
