// Client chat: every live client's team chat in one place, like a messaging app.
// Left, the clients with unread first; right, the open thread with a composer.
// The same thread also lives on the client's page; this is the inbox view of all of them.

import { redirect } from "next/navigation";
import { currentOps } from "@/lib/auth";
import { threads, thread, markRead } from "@/lib/team-chat";
import { ChatView } from "./ChatView";
import { clientIMessagePhone, defaultLine } from "@/lib/imessage";

export const dynamic = "force-dynamic";

export default async function AdminChat({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const me = await currentOps();
  if (!me) redirect("/admin/login");
  const { business } = await searchParams;
  const list = await threads();
  const selected = Number(business ?? 0) || list[0]?.id || 0;
  const messages = selected ? await thread(selected) : [];
  if (selected && messages.some((m) => m.sender === "client" && !m.read_at)) await markRead(selected);
  const [line, imessagePhone] = await Promise.all([defaultLine(), selected ? clientIMessagePhone(selected) : Promise.resolve("")]);
  return <ChatView threads={list} selected={selected} initial={messages} me={me.name} imessagePhone={imessagePhone} lineReady={Boolean(line)} />;
}
