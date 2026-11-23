"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import "./app-dialog-provider.css";

type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
};

type DialogRequest = {
  kind: "alert" | "confirm";
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "default" | "danger";
  resolve: (confirmed: boolean) => void;
};

type DialogContextValue = {
  alert: (message: string, options?: Pick<DialogOptions, "title" | "confirmLabel">) => Promise<void>;
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function AppDialog({ request, onResolve }: {
  request: DialogRequest | null;
  onResolve: (confirmed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!request || !element) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [request]);

  return <dialog
    ref={dialog}
    className="app-alert-dialog"
    aria-labelledby={titleId}
    aria-describedby={messageId}
    aria-modal="true"
    role={request?.kind === "alert" ? "alertdialog" : "dialog"}
    onCancel={event => { event.preventDefault(); onResolve(false); }}
  >
    {request && <>
      <h2 id={titleId}>{request.title}</h2>
      <p id={messageId}>{request.message}</p>
      <div className="app-alert-dialog-actions">
        {request.kind === "confirm" && <button
          type="button"
          className="app-dialog-cancel"
          autoFocus={request.variant === "danger"}
          onClick={() => onResolve(false)}
        >{request.cancelLabel}</button>}
        <button
          type="button"
          className={`primary-button${request.variant === "danger" ? " is-danger" : ""}`}
          autoFocus={request.kind === "alert" || request.variant !== "danger"}
          onClick={() => onResolve(true)}
        >{request.confirmLabel}</button>
      </div>
    </>}
  </dialog>;
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queue = useRef<DialogRequest[]>([]);

  const enqueue = useCallback((request: Omit<DialogRequest, "resolve">) => new Promise<boolean>(resolve => {
    const pending = { ...request, resolve };
    if (activeRef.current) queue.current.push(pending);
    else {
      activeRef.current = pending;
      setActive(pending);
    }
  }), []);

  const alert = useCallback(async (message: string, options: Pick<DialogOptions, "title" | "confirmLabel"> = {}) => {
    await enqueue({
      kind: "alert",
      title: options.title ?? "Notice",
      message,
      confirmLabel: options.confirmLabel ?? "OK",
      cancelLabel: "Cancel",
      variant: "default",
    });
  }, [enqueue]);

  const confirm = useCallback((message: string, options: DialogOptions = {}) => enqueue({
    kind: "confirm",
    title: options.title ?? "Please confirm",
    message,
    confirmLabel: options.confirmLabel ?? "Confirm",
    cancelLabel: options.cancelLabel ?? "Cancel",
    variant: options.variant ?? "default",
  }), [enqueue]);

  const resolve = useCallback((confirmed: boolean) => {
    const current = activeRef.current;
    if (!current) return;
    activeRef.current = null;
    current.resolve(confirmed);
    const next = queue.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  return <DialogContext.Provider value={{ alert, confirm }}>
    {children}
    <AppDialog request={active} onResolve={resolve}/>
  </DialogContext.Provider>;
}

export function useAppDialogs() {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error("useAppDialogs must be used inside AppDialogProvider.");
  return dialogs;
}
