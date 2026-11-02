"use client";

import { PasswordField } from "@/components/ui/password-field";

import { BrandLogo } from "@/components/ui/brand-logo";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ScanLine } from "lucide-react";
import Link from "next/link";
import "./login-qr.css";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";
import { employeeLoginToAuthEmail } from "@/lib/auth/employee-login";

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "inactive") {
      setError("This account has no active staff profile. Run the bootstrap admin SQL using the same email as your Supabase user, then try again.");
    } else if (params.get("error") === "invite") {
      setError("This invitation link could not be completed. Ask the admin to send a new invitation.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: employeeLoginToAuthEmail(loginId), password });
      if (authError) throw authError;
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next === "/scan-qr" ? "/scan-qr" : "/dashboard"); router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not sign in.";
      const connectionFailed = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);
      setError(connectionFailed
        ? "Cannot connect to the sign-in service. Check your internet connection, VPN, or DNS settings, then try again."
        : message);
    }
    finally { setBusy(false); }
  }

  return <main className="login-screen"><div className="login-options"><form className="login-card" onSubmit={submit}>
    <BrandLogo/><div className="section-kicker">SUBLI-NATION PRINTING SYSTEM</div><h1>Welcome back</h1>
    <p>Sign in with your employee account to open the production workspace.</p>
    {!supabaseConfigured && <div className="login-setup"><AlertCircle size={16}/><span>Supabase isn’t connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then restart the app.</span></div>}
    {error && <div className="login-error" role="alert">{error}</div>}
    <label>Login ID or email<input required autoComplete="username" value={loginId} onChange={event => setLoginId(event.target.value)} placeholder="Your employee ID or email"/></label>
    <PasswordField label="Password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Your password"/>
    <button className="primary-button" type="submit" disabled={!supabaseConfigured || busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <small>Use the login ID and password provided by your admin. Existing email accounts can still sign in with their email.</small>
  </form><Link href="/scan-qr" className="login-qr-card"><span className="login-qr-icon"><ScanLine size={48}/></span><h2>Scan QR</h2><p>Fast-track attendance or check-in using your personalized QR code.</p><small>No login needed for attendance</small></Link></div></main>;
}
