"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

export function AttendanceDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  return <dialog className="attendance-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>;
}
