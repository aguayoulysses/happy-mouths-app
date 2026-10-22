"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./LangProvider";

const ICON = {
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  clients: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M17.5 13.5a6.5 6.5 0 0 1 4 6.5" /></svg>,
  reviews: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z" /></svg>,
  system: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></svg>,
};

export function OpsNav({ chat, replies, systemDown }: { chat: number; replies: number; systemDown: number }) {
  const path = usePathname() ?? "";
  const t = useT();
  // Simple board: the clients and what they need from us, plus the plumbing.
  const groups: { label: string; items: { href: string; label: string; icon: React.ReactNode; active: boolean; count: number; external?: boolean }[] }[] = [
    { label: "Overview", items: [
      { href: "/admin", label: "Dashboard", icon: ICON.board, active: path === "/admin" || path === "/", count: 0 },
    ] },
    { label: "Clients", items: [
      { href: "/admin/clients", label: "All clients", icon: ICON.clients, active: path.startsWith("/admin/clients") || /^\/admin\/\d+/.test(path), count: 0 },
      { href: "/admin/chat", label: "Messages", icon: ICON.chat, active: path.startsWith("/admin/chat"), count: chat },
      { href: "/admin/reviews", label: "Reviews", icon: ICON.reviews, active: path.startsWith("/admin/reviews"), count: replies },
    ] },
    { label: "Admin", items: [
      { href: "/admin/system", label: "System", icon: ICON.system, active: path.startsWith("/admin/system"), count: systemDown },
    ] },
  ];
  return (
    <nav>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="nav-label">{t(g.label)}</div>
          {g.items.map((i) =>
            i.external ? (
              <a key={i.href} href={i.href} target="_blank" rel="noreferrer" className="nav-item" title="Opens in a new tab">
                {i.icon}
                {t(i.label)}
                <span aria-hidden style={{ marginLeft: "auto", opacity: 0.7, fontSize: "0.8em" }}>↗</span>
              </a>
            ) : (
              <Link key={i.href} href={i.href} className={`nav-item ${i.active ? "active" : ""}`}>
                {i.icon}
                {t(i.label)}
                {i.count > 0 && <span className="nav-count">{i.count}</span>}
              </Link>
            )
          )}
        </div>
      ))}
    </nav>
  );
}
