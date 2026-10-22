"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeMessages, messageColumns, type TeamMessage } from "@/lib/team-messages";
import "./team-chat.css";

const errorMessage = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not connect to team messages.";
const dateFormatter = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export function TeamChat({ userId, initialMessages }: { userId: string; initialMessages: TeamMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(initialMessages.length === 50);
  const [sendError, setSendError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const latestId = useRef(initialMessages.at(-1)?.id ?? 0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    const poll = async () => {
      if (!active) return;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 12000);
      setRefreshing(true);
      try {
        const { data, error } = await createClient().from("team_messages").select(messageColumns)
          .gt("id", latestId.current).order("id").limit(100).abortSignal(request.signal);
        if (error) throw error;
        if (!active) return;
        const rows = (data ?? []) as unknown as TeamMessage[];
        if (rows.length) {
          latestId.current = rows[rows.length - 1].id;
          setMessages(current => mergeMessages(current, rows));
        }
        setConnectionError("");
        setLastUpdated(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", timeStyle: "medium" }).format(new Date()));
      } catch (cause) { if (active) setConnectionError(errorMessage(cause)); }
      finally {
        clearTimeout(timeout);
        if (active) { setRefreshing(false); timer = setTimeout(poll, 4000); }
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); request?.abort(); };
  }, [refreshAttempt]);

  useEffect(() => {
    if (followLatest.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (loadingOlder || !messages.length) return;
    setLoadingOlder(true);
    const element = scroll.current;
    const previousHeight = element?.scrollHeight ?? 0;
    try {
      const { data, error } = await createClient().from("team_messages").select(messageColumns)
        .lt("id", messages[0].id).order("id", { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(12000));
      if (error) throw error;
      const rows = (data ?? []) as unknown as TeamMessage[];
      followLatest.current = false;
      setMessages(current => mergeMessages(current, rows));
      setHasOlder(rows.length === 50);
      setConnectionError("");
      requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - previousHeight; });
    } catch (cause) { setConnectionError(errorMessage(cause)); }
    finally { setLoadingOlder(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || text.length > 2000 || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setSendError("");
    try {
      const { data, error } = await createClient().from("team_messages").insert({ body: text }).select(messageColumns).abortSignal(AbortSignal.timeout(15000)).single();
      if (error) throw error;
      followLatest.current = true;
      setMessages(current => mergeMessages(current, [data as unknown as TeamMessage]));
      setBody("");
    } catch (cause) { setSendError(`${errorMessage(cause)} Your text has been kept. Refresh the conversation to check whether it was delivered before sending again.`); }
    finally { sendingRef.current = false; setSending(false); }
  }

  return <section className="team-chat">
    <div className="team-chat-heading"><h2>Everyone</h2><span role="status">{refreshing ? "Checking for messages…" : connectionError ? "Connection interrupted" : lastUpdated ? `Connected · Updated ${lastUpdated}` : "Connecting…"}</span><button className="filter-button" type="button" onClick={() => setRefreshAttempt(value => value + 1)}>Refresh messages</button></div>
    {connectionError && <p role="alert" className="employee-error">Messages could not refresh: {connectionError} Retrying automatically.</p>}
    <div className="team-chat-history" ref={scroll} role="region" aria-label="Team message history" tabIndex={0}
      onScroll={() => { const el = scroll.current; if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {hasOlder && <button className="team-chat-older" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : "Load older messages"}</button>}
      {!messages.length && <p className="team-chat-empty">No messages yet. Start the team conversation below.</p>}
      {messages.map(message => <article key={message.id} className={`team-chat-message${message.sender_id === userId ? " is-own" : ""}`}>
        <div className="team-chat-meta"><strong>{message.sender?.full_name ?? "Staff member"}{message.sender_id === userId ? " (you)" : ""}</strong><time dateTime={message.created_at}>{dateFormatter.format(new Date(message.created_at))}</time></div>
        <div className="team-chat-body">{message.body}</div>
      </article>)}
    </div>
    <form className="team-chat-compose" onSubmit={send}>
      <label htmlFor="team-message">Message everyone</label>
      <textarea id="team-message" required maxLength={2000} rows={3} value={body} disabled={sending} onChange={event => setBody(event.target.value)} placeholder="Write a message to the team…"/>
      <div className="team-chat-actions"><small>{body.length}/2000</small><button className="primary-button" type="submit" disabled={sending || !body.trim()}>{sending ? "Sending…" : "Send message"}</button></div>
      {sendError && <p role="alert" className="employee-error">{sendError}</p>}
    </form>
  </section>;
}
