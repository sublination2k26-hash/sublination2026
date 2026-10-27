"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CameraOff, QrCode, ScanLine, Upload } from "lucide-react";
import { createClient, supabaseConfigured } from "@/lib/supabase/client";
import { manilaToday, punchLabels, type Punch } from "@/lib/attendance";
import { QrCamera } from "./qr-camera";
import "./qr-check-in.css";

export function QrCheckIn() {
  const [db] = useState(() => supabaseConfigured ? createClient() : null);
  const [day, setDay] = useState(manilaToday);
  const [counts, setCounts] = useState({ am: 0, pm: 0, last: "None" });
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]), [cameraId, setCameraId] = useState("");
  const [cameraOn, setCameraOn] = useState(false), [cameraReady, setCameraReady] = useState(false);
  const [action, setAction] = useState<Punch>("am_in"), [token, setToken] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null), recording = useRef(false);
  const canScan = !!db;
  const listCameras = async () => {
    try { const { default: Scanner } = await import("qr-scanner"); setCameras(await Scanner.listCameras(false)); }
    catch { /* Upload and USB scanning remain available without a camera. */ }
  };
  const record = async (value: string) => {
    if (recording.current || !canScan || !db) return;
    setCameraOn(false); setCameraReady(false); setError(""); setNotice("");
    const clean = value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) { setError("This is not an employee attendance QR code. Use the code issued by your admin."); return; }
    recording.current = true; setBusy(true);
    try {
      const result = await db.rpc("public_clock_attendance_qr", { p_token: clean, p_action: action });
      if (result.error) throw result.error;
      setToken(""); setNotice(`${punchLabels[action]} recorded at ${new Date().toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}.`);
      setDay(manilaToday());
      setCounts(value => ({ am: value.am + (action.startsWith("am_") ? 1 : 0), pm: value.pm + (action.startsWith("pm_") ? 1 : 0), last: punchLabels[action] }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { recording.current = false; setBusy(false); }
  };
  const uploadQr = async (file?: File) => {
    if (!file || !canScan || recording.current) return;
    setCameraOn(false); setCameraReady(false); setError("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) { setError("Choose a PNG, JPEG or WebP QR image smaller than 10 MB."); return; }
    setBusy(true);
    try {
      const { default: Scanner } = await import("qr-scanner");
      const result = await Scanner.scanImage(file, { returnDetailedScanResult: true });
      await record(result.data);
    } catch { setError("No readable QR code found. Upload a clear, uncropped image of your employee QR code."); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };
  const stats = [
    { label: "Scans this visit", value: counts.am + counts.pm },
    { label: "AM entries", value: counts.am }, { label: "PM entries", value: counts.pm },
    { label: "Last action", value: counts.last },
  ];
  return <main className="qr-check-in">
    <header className="qr-check-header"><Link href="/login"><ArrowLeft size={18}/>System login</Link><span>Subli-nation · Attendance</span></header>
    <div className="qr-check-content"><div className="qr-check-title"><div><span className="qr-check-eyebrow">EMPLOYEE ATTENDANCE</span><h1><QrCode size={30}/>Scan QR</h1><p>Check in and out using your personalized QR code.</p></div><span>{new Date(`${day}T12:00:00+08:00`).toLocaleDateString("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" })}</span></div>
      <div className="qr-check-stats">{stats.map(stat => <div key={stat.label}><b>{stat.value}</b><span>{stat.label}</span></div>)}</div>
      <section className="qr-check-panel" aria-label="Attendance QR scanner" aria-busy={busy}>
        <p className="qr-check-account">Scan your employee QR code to record attendance. No login required.</p>
        {!db && <p className="qr-check-error">Attendance is not configured yet. Contact your admin.</p>}
        {error && <p className="qr-check-error" role="alert">{error}</p>}{notice && <p className="qr-check-success" role="status">{notice}</p>}
        <div className={`qr-check-status ${cameraReady ? "active" : ""}`} role="status">{cameraReady ? <Camera size={21}/> : <CameraOff size={21}/>}Scanner {cameraReady ? "Active" : cameraOn ? "Starting…" : "Inactive"}</div>
        <div className="qr-check-controls"><label><span>Camera</span><select value={cameraId} disabled={cameraOn || !canScan || busy} onFocus={() => void listCameras()} onChange={event => setCameraId(event.target.value)}><option value="">Select Camera… (automatic)</option>{cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Camera ${index + 1}`}</option>)}</select></label><button className="qr-start-camera" disabled={!canScan || busy} onClick={() => { if (cameraOn) { setCameraOn(false); setCameraReady(false); } else { setError(""); setCameraOn(true); } }}><Camera size={17}/>{cameraOn ? "Stop Camera" : "Start Camera"}</button><button className="qr-upload-button" disabled={!canScan || busy} onClick={() => upload.current?.click()}><Upload size={17}/>Upload QR</button><input ref={upload} className="qr-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void uploadQr(event.target.files?.[0])} aria-label="Upload employee QR image"/></div>
        <label className="qr-check-action">Clock action<select value={action} disabled={cameraOn || busy || !canScan} onChange={event => setAction(event.target.value as Punch)}>{(Object.keys(punchLabels) as Punch[]).map(key => <option key={key} value={key}>{punchLabels[key]}</option>)}</select></label>
        <div className="qr-check-viewfinder">{cameraOn ? <QrCamera cameraId={cameraId} onReady={() => { setCameraReady(true); void listCameras(); }} onError={value => { setCameraOn(false); setCameraReady(false); setError(value); }} onScan={value => void record(value)}/> : <div><ScanLine size={52}/><p>{busy ? "Reading QR and saving attendance…" : "Start your camera or upload your employee QR code"}</p></div>}</div>
        {canScan && <form className="qr-check-manual" onSubmit={event => { event.preventDefault(); void record(token); }}><label>QR code / USB scanner input<input required autoComplete="off" value={token} onChange={event => setToken(event.target.value)} placeholder="Scan or paste the full QR value" disabled={busy || cameraOn}/></label><button disabled={busy || cameraOn}>Record attendance</button></form>}
        <p className="qr-check-footnote">Philippine date and time are recorded automatically. Counters show successful scans during this visit. Camera access requires HTTPS or localhost.</p>
      </section>
    </div>
  </main>;
}
function errorMessage(reason: unknown) { return reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "Could not record attendance. Try again."; }
