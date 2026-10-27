"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ExportColumn, ExportValue } from "@/lib/excel-export";

export function ExcelExport({ title, columns, rows, label = "Export Excel" }: { title: string; columns: ExportColumn[]; rows: ExportValue[][]; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    if (busy) return;
    setBusy(true);setError("");
    try {
      const { buildExcelReport } = await import("@/lib/excel-export");
      const buffer = await buildExcelReport(title, columns, rows);
      const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.xlsx`;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      setError("Could not export Excel. Please try again.");
    } finally { setBusy(false); }
  };
  return <div><button type="button" className="filter-button" disabled={busy||!rows.length} onClick={()=>void download()}><Download size={15}/>{busy?"Preparing…":label}</button>{error&&<p role="alert">{error}</p>}</div>;
}
