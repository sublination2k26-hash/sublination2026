"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Sparkles } from "lucide-react";
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
      router.replace("/dashboard"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <span className="brand-icon"><Sparkles size={19}/></span><div className="section-kicker">SUBLI-NATION PRINTING SYSTEM</div><h1>Welcome back</h1>
    <p>Sign in with your employee account to open the production workspace.</p>
    {!supabaseConfigured && <div className="login-setup"><AlertCircle size={16}/><span>Supabase isn’t connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then restart the app.</span></div>}
    {error && <div className="login-error" role="alert">{error}</div>}
    <label>Login ID or email<input required autoComplete="username" value={loginId} onChange={event => setLoginId(event.target.value)} placeholder="Your employee ID or email"/></label>
    <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Your password"/></label>
    <button className="primary-button" type="submit" disabled={!supabaseConfigured || busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <small>Use the login ID and password provided by your admin. Existing email accounts can still sign in with their email.</small>
  </form></main>;
}
