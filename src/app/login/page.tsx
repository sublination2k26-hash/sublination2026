"use client";

import { PasswordField } from "@/components/ui/password-field";

import { BrandLogo } from "@/components/ui/brand-logo";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import "./login-qr.css";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";
import { employeeLoginToAuthEmail } from "@/lib/auth/employee-login";
import { watchLoginSession } from "@/lib/auth/login-session";
import { withWorkspaceTimeout } from "@/lib/workspace-loading";

export default function LoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(false);
  const [checkingSession,setCheckingSession] = useState(supabaseConfigured);

  useEffect(()=>{
    if(!supabaseConfigured)return;
    return watchLoginSession(window,async()=>{
      const {data:{user},error}=await withWorkspaceTimeout(createClient().auth.getUser(),10000);
      return !error&&Boolean(user);
    },()=>setCheckingSession(false));
  },[]);

  useEffect(() => {
    try { const saved = localStorage.getItem("subli.login.username.v1"); if (saved) { setLoginId(saved); setRememberUsername(true); } } catch {}
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "inactive") {
      setError("This account has no active staff profile. Run the bootstrap admin SQL using the same email as your Supabase user, then try again.");
    } else if (params.get("error") === "invite") {
      setError("This invitation link could not be completed. Ask the admin to send a new invitation.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const credentials = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: employeeLoginToAuthEmail(String(credentials.get("username") ?? "")),
        password: String(credentials.get("password") ?? ""),
      });
      if (authError) throw authError;
      try { if (rememberUsername) localStorage.setItem("subli.login.username.v1", String(credentials.get("username") ?? "")); else localStorage.removeItem("subli.login.username.v1"); } catch {}
      window.location.replace("/dashboard");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not sign in.";
      const connectionFailed = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);
      setError(connectionFailed
        ? "Cannot connect to the sign-in service. Check your internet connection, VPN, or DNS settings, then try again."
        : message);
    }
    finally { setBusy(false); }
  }

  if(checkingSession)return <main className="login-screen"><div className="login-card" role="status">Checking your session…</div></main>;
  return <main className="login-screen"><div className="login-options"><form id="login-form" className="login-card" method="post" autoComplete="on" onSubmit={submit}>
    <BrandLogo/><div className="section-kicker">SUBLI-NATION PRINTING SYSTEM</div><h1>Welcome back</h1>
    <p>Sign in with your employee account to open the production workspace.</p>
    {!supabaseConfigured && <div className="login-setup"><AlertCircle size={16}/><span>Supabase isn’t connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then restart the app.</span></div>}
    {error && <div className="login-error" role="alert">{error}</div>}
    <label htmlFor="login-username">Login ID or email<input id="login-username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={loginId} onChange={event => setLoginId(event.target.value)} placeholder="Your employee ID or email"/></label>
    <PasswordField id="login-password" name="password" label="Password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Your password"/>
    <label><input type="checkbox" checked={rememberUsername} onChange={event => { setRememberUsername(event.target.checked); if (!event.target.checked) { try { localStorage.removeItem("subli.login.username.v1"); } catch {} } }}/> Remember my username on this device</label>
    <button className="primary-button" type="submit" disabled={!supabaseConfigured || busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <Link href="/forgot-password">Forgot password?</Link>
    <small>Use the login ID and password provided by your admin. Existing email accounts can still sign in with their email.</small>
    <small>Allow your browser to save your login for autofill next time. You stay signed in on this browser until you sign out or your session expires.</small>
  </form></div></main>;
}
