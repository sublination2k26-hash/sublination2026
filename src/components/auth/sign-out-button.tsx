"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setBusy(false);
      return;
    }
    window.location.replace("/login");
  }

  return <span className="sign-out-control">
    <button className="logout-button" type="button" onClick={() => void signOut()} disabled={busy} aria-label={busy ? "Signing out" : "Sign out"} title={busy ? "Signing out" : "Sign out"}>
      <LogOut size={16}/>
    </button>
    {error && <small role="alert">{error}</small>}
  </span>;
}
