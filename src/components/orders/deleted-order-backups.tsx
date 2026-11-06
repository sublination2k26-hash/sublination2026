"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function DeletedOrderBackups() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function download() {
    setBusy(true); setMessage("");
    try {
      const rows = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await createClient().from("deleted_order_backups").select("*").order("deleted_at").order("id").range(offset, offset + 99);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 100) break;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), orders: rows }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `deleted-orders-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`${rows.length} deleted order backups downloaded.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not download backups."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h2>Deleted order backups</h2><p>Orders and their related records are backed up automatically before deletion. Download a copy for safekeeping.</p><button type="button" className="filter-button" disabled={busy} onClick={() => void download()}>{busy ? "Downloading…" : "Download deleted order backups"}</button>{message && <p role="status">{message}</p>}</section>;
}
