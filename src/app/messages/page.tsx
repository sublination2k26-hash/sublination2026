import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { TeamChat } from "@/components/messages/team-chat";
import { createClient } from "@/lib/supabase/server";
import { messageColumns, replyColumns, loadMessageReplies, type TeamMessage, type MessageAccount } from "@/lib/team-messages";

export default async function MessagesPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (!profile?.active) redirect("/login");
  const [{ data, error }, accounts] = await Promise.all([
    db.from("team_messages").select(messageColumns).order("id", { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(15000)),
    db.from("profiles").select("id,full_name,role").eq("active", true).order("full_name").abortSignal(AbortSignal.timeout(15000)),
  ]);
  let messages = (data ?? []).reverse() as unknown as TeamMessage[];
  let replyError = "";
  try {
    messages = await loadMessageReplies(messages, ids => db.from("team_messages").select(replyColumns).in("id", ids).returns<NonNullable<TeamMessage["reply"]>[]>().abortSignal(AbortSignal.timeout(15000)));
  } catch (cause) { replyError = cause instanceof Error ? cause.message : "Quoted replies could not load."; }
  return <SectionPage area="Messages" title="Team messages" description="Everyone can send messages, reply to teammates, and mention active accounts.">
    {error && <p role="alert" className="employee-error">Message history could not load: {error.message} The conversation below will try to reconnect.</p>}
    {accounts.error && <p role="alert">Accounts for mentions could not load. Refresh this page to retry.</p>}
    {replyError && <p role="alert">Quoted replies could not load: {replyError}</p>}
    <TeamChat userId={user.id} accounts={(accounts.data ?? []) as MessageAccount[]} initialMessages={messages}/>
  </SectionPage>;
}
