"use client";

import { useEffect, useRef, useState } from "react";

export function QrCamera({ onScan, cameraId, onReady, onError }: { onScan: (token: string) => void; cameraId?: string; onReady?: () => void; onError?: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScan);
  callback.current = onScan;
  const ready = useRef(onReady), failed = useRef(onError);
  ready.current = onReady; failed.current = onError;
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let scanner: import("qr-scanner").default | undefined;
    void (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !video.current) return;
        let scanned = false;
        scanner = new QrScanner(video.current, result => {
          if (scanned || cancelled) return;
          scanned = true;
          scanner?.stop();
          callback.current(result.data);
        }, { preferredCamera: cameraId || "environment", highlightScanRegion: true, returnDetailedScanResult: true });
        await scanner.start();
        if (cancelled) scanner.destroy();
        else ready.current?.();
      } catch { if (!cancelled) { const message = "Camera unavailable. Allow camera access on HTTPS or localhost, or upload a QR image."; setError(message); failed.current?.(message); } }
    })();
    return () => { cancelled = true; scanner?.destroy(); };
  }, [cameraId]);
  return <div className="attendance-camera"><video ref={video} muted playsInline aria-label="Employee QR scanner"/>{error && <p role="alert">{error}</p>}</div>;
}
