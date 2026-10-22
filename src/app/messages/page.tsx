import { redirect } from "next/navigation";
import { SectionPage } from "@/components/layout/section-page";
import { TeamChat } from "@/components/messages/team-chat";
import { createClient } from "@/lib/supabase/server";
import { messageColumns, type TeamMessage } from "@/lib/team-messages";

export default async function MessagesPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (!profile?.active) redirect("/login");
  const { data, error } = await db.from("team_messages").select(messageColumns).order("id", { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(15000));
  return <SectionPage area="Messages" title="Team messages" description="A shared conversation for all employees and admins.">
    {error && <p role="alert" className="employee-error">Message history could not load: {error.message} The conversation below will try to reconnect.</p>}
    <TeamChat userId={user.id} initialMessages={(data ?? []).reverse() as unknown as TeamMessage[]}/>
  </SectionPage>;
}
