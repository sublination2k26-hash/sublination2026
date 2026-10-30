export type TeamMessage = {
  id: number;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { full_name: string } | null;
  reply_to_id: number | null;
  reply: { id: number; body: string; sender: { full_name: string } | null } | null;
  mentioned_user_ids: string[];
  activity_task_id: string | null;
};

export type MessageAccount = { id: string; full_name: string; role: string };

export const messageColumns = "id,sender_id,body,created_at,reply_to_id,mentioned_user_ids,activity_task_id,sender:profiles!team_messages_sender_id_fkey(full_name)";

type ReplyContext = NonNullable<TeamMessage["reply"]>;
export async function loadMessageReplies(
  messages: TeamMessage[],
  fetchParents: (ids: number[]) => PromiseLike<{ data: ReplyContext[] | null; error: { message: string } | null }>,
) {
  const byId = new Map<number, ReplyContext>(messages.map(message => [message.id, message]));
  const missing = [...new Set(messages.flatMap(message => message.reply_to_id && !byId.has(message.reply_to_id) ? [message.reply_to_id] : []))];
  if (missing.length) {
    const { data, error } = await fetchParents(missing);
    if (error) throw new Error(error.message);
    for (const parent of data ?? []) byId.set(parent.id, parent);
  }
  return messages.map(message => ({ ...message, reply: message.reply_to_id ? byId.get(message.reply_to_id) ?? null : null }));
}

export const replyColumns = "id,body,sender:profiles!team_messages_sender_id_fkey(full_name)";

export function mentionToken(account: MessageAccount) {
  return `@[${account.full_name}](${account.id})`;
}

export function mentionedAccounts(body: string, accounts: MessageAccount[]) {
  return accounts.filter(account => body.includes(mentionToken(account))).map(account => account.id);
}

export function encodeMentions(body: string, accounts: MessageAccount[]) {
  // Longer names first so @Ann does not consume the start of @Anna.
  return [...accounts].sort((a, b) => b.full_name.length - a.full_name.length)
    .reduce((text, account) => {
      const escaped = account.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return text.replace(new RegExp(`@${escaped}(?=$|[\\s.,!?;:])`, "g"), () => mentionToken(account));
    }, body);
}

export function mergeMessages(current: TeamMessage[], incoming: TeamMessage[]) {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.id - b.id);
}
