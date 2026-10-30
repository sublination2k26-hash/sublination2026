"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeMessages, messageColumns, replyColumns, loadMessageReplies, encodeMentions, mentionedAccounts, type TeamMessage, type MessageAccount } from "@/lib/team-messages";
import "./team-chat.css";

const errorMessage = (error: unknown) => typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Could not connect to team messages.";
const dateFormatter = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export function TeamChat({ userId, initialMessages, accounts }: { userId: string; initialMessages: TeamMessage[]; accounts: MessageAccount[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [mentionSearch, setMentionSearch] = useState("");
  const [selectedMentions, setSelectedMentions] = useState<MessageAccount[]>([]);
  const composer = useRef<HTMLTextAreaElement>(null);
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
        const rows = await loadMessageReplies((data ?? []) as unknown as TeamMessage[], ids => createClient().from("team_messages").select(replyColumns).in("id", ids).returns<NonNullable<TeamMessage["reply"]>[]>().abortSignal(request!.signal));
        if (!active) return;
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
      const rows = await loadMessageReplies((data ?? []) as unknown as TeamMessage[], ids => createClient().from("team_messages").select(replyColumns).in("id", ids).returns<NonNullable<TeamMessage["reply"]>[]>().abortSignal(AbortSignal.timeout(12000)));
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
    const text = encodeMentions(body.trim(), selectedMentions);
    if (!text || sendingRef.current) return;
    if (text.length > 2000) { setSendError("This message is too long including its mentions. Shorten it and try again."); return; }
    sendingRef.current = true; setSending(true); setSendError("");
    try {
      const { data, error } = await createClient().from("team_messages").insert({ body: text, reply_to_id: replyTo?.id ?? null, mentioned_user_ids: mentionedAccounts(text, accounts) }).select(messageColumns).abortSignal(AbortSignal.timeout(15000)).single();
      if (error) throw error;
      followLatest.current = true;
      setMessages(current => mergeMessages(current, [{ ...data, reply: replyTo ? { id: replyTo.id, body: replyTo.body, sender: replyTo.sender } : null } as unknown as TeamMessage]));
      setBody("");
      setReplyTo(null);
      setSelectedMentions([]);
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
        {message.activity_task_id && <small className="team-chat-activity">Layout activity</small>}
        {message.mentioned_user_ids?.includes(userId) && <small className="team-chat-mention">You were mentioned</small>}
        {message.reply && <blockquote className="team-chat-quote"><strong>Reply to {message.reply.sender?.full_name ?? "Staff member"}</strong><MessageBody body={message.reply.body}/></blockquote>}
        <div className="team-chat-body"><MessageBody body={message.body}/></div>
        <button className="link-button" type="button" disabled={sending} onClick={() => { setReplyTo(message); composer.current?.focus(); }}>Reply</button>
      </article>)}
    </div>
    <form className="team-chat-compose" onSubmit={send}>
      <label htmlFor="team-message">Message everyone</label>
      {replyTo && <div className="team-chat-quote"><strong>Replying to {replyTo.sender?.full_name ?? "Staff member"}</strong><MessageBody body={replyTo.body}/><button type="button" className="link-button" disabled={sending} onClick={() => setReplyTo(null)}>Cancel reply</button></div>}
      <details className="team-chat-accounts"><summary>Mention an account</summary><label htmlFor="mention-search">Find employee</label><input id="mention-search" value={mentionSearch} onChange={event => setMentionSearch(event.target.value)} placeholder="Name or role"/><div>{accounts.filter(account => `${account.full_name} ${account.role}`.toLowerCase().includes(mentionSearch.toLowerCase())).map(account => <button key={account.id} className="quiet-button" type="button" disabled={sending} onClick={() => { setSelectedMentions(current => [...current.filter(item => item.id !== account.id), account]); setBody(current => `${current}${current && !current.endsWith(" ") ? " " : ""}@${account.full_name} `); composer.current?.focus(); }}>@{account.full_name} · {account.role.replaceAll("_", " ")}</button>)}</div></details>
      <textarea ref={composer} id="team-message" required maxLength={2000} rows={3} value={body} disabled={sending} onChange={event => setBody(event.target.value)} placeholder="Write a message to the team…"/>
      <div className="team-chat-actions"><small>{body.length}/2000</small><button className="primary-button" type="submit" disabled={sending || !body.trim()}>{sending ? "Sending…" : "Send message"}</button></div>
      {sendError && <p role="alert" className="employee-error">{sendError}</p>}
    </form>
  </section>;
}

function MessageBody({ body }: { body: string }) {
  return <>{body.split(/(@\[[\s\S]*?\]\([0-9a-f-]{36}\))/gi).map((part, index) => {
    const mention = /^@\[([\s\S]*?)\]\(([0-9a-f-]{36})\)$/i.exec(part);
    return mention ? <mark key={index} className="team-chat-mention">@{mention[1]}</mark> : part;
  })}</>;
}
