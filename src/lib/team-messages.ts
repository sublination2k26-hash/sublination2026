export type TeamMessage = {
  id: number;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { full_name: string } | null;
};

export const messageColumns = "id,sender_id,body,created_at,sender:profiles!team_messages_sender_id_fkey(full_name)";

export function mergeMessages(current: TeamMessage[], incoming: TeamMessage[]) {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.id - b.id);
}
