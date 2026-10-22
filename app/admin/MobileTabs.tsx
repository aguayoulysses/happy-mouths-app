"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useT } from "./LangProvider";

// Phone layout (≤760px, and the iOS Ops app): the sidebar hides behind "More" and the
// four screens the team opens all day sit in a bottom tab bar. "More" is a label for the
// #ops-more checkbox next to the sidebar, so the sheet opens with CSS alone; any
// navigation closes it again.
export function MobileTabs({ chat, replies, other }: { chat: number; replies: number; other: number }) {
  const path = usePathname() ?? "";
  const t = useT();
  useEffect(() => {
    const box = document.getElementById("ops-more") as HTMLInputElement | null;
    if (box) box.checked = false;
  }, [path]);
  const tabs = [
    { href: "/admin", label: "Dashboard", active: path === "/admin" || path === "/", count: 0, icon: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></> },
    { href: "/admin/clients", label: "Clients", active: path.startsWith("/admin/clients") || /^\/admin\/\d+/.test(path), count: 0, icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M17.5 13.5a6.5 6.5 0 0 1 4 6.5" /></> },
    { href: "/admin/chat", label: "Messages", active: path.startsWith("/admin/chat"), count: chat, icon: <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z" /> },
    { href: "/admin/reviews", label: "Reviews", active: path.startsWith("/admin/reviews"), count: replies, icon: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" /> },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`tab ${tab.active ? "on" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{tab.icon}</svg>
          {t(tab.label)}
          {tab.count > 0 && <span className="tab-count">{tab.count}</span>}
        </Link>
      ))}
      <label htmlFor="ops-more" className="tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
        {t("More")}
        {other > 0 && <span className="tab-count">{other}</span>}
      </label>
    </nav>
  );
}
