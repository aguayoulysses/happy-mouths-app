import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { navigate, useRoute, type Route } from "../lib/router";
import { tap } from "../lib/native";
import { TeamButton } from "./TeamButton";
import { MARK, NAME } from "../brand";

type Tab = { to: Route; label: string; icon: keyof typeof Icon; badge?: boolean };
const BASE_TABS: Tab[] = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/customers", label: "Customers", icon: "people" },
  { to: "/reviews", label: "Reviews", icon: "star" },
  { to: "/settings", label: "Settings", icon: "settings" },
];
// Optional sections slot in only for a business that has them switched on.
const PHONE_TAB: Tab = { to: "/phone", label: "Phone", icon: "phone" };

const mascot = MARK;

export function Shell({ business, title, phone, badge = false, children }: { business: string; title: string; phone: boolean; badge?: boolean; children: ReactNode }) {
  const route = useRoute();
  const TABS = phone ? [BASE_TABS[0], BASE_TABS[1], { ...PHONE_TAB, badge }, BASE_TABS[2], BASE_TABS[3]] : BASE_TABS;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 44);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [route]);
  const go = (to: Route) => {
    tap();
    navigate(to);
  };
  return (
    <>
      <aside className="rail">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <img src={mascot} alt="" width={28} height={28} />
          <span className="text-[15px] font-extrabold tracking-tight">{NAME}</span>
        </div>
        <nav className="px-3">
          {TABS.map((t) => {
            const I = Icon[t.icon];
            const active = route === t.to;
            return (
              <button key={t.to} type="button" onClick={() => go(t.to)} className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors ${active ? "bg-ground text-ink" : "text-ink-soft hover:text-ink"}`}>
                <I width={18} height={18} strokeWidth={active ? 2.2 : 1.8} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="absolute bottom-6 left-6 right-6">
          <TeamButton className="mb-3" />
          <div className="truncate text-[13px] font-semibold text-ink-mute">{business}</div>
        </div>
      </aside>

      <header className={`top-bar ${scrolled ? "scrolled" : ""}`}>
        <div className="mx-auto flex h-[var(--header-h)] max-w-[1040px] items-center justify-center px-4 md:justify-start md:px-10">
          <span className="bar-title truncate text-[16px] font-bold tracking-tight">{title}</span>
        </div>
      </header>

      <main className="page">{children}</main>

      <nav className="tab-bar" aria-label="Sections">
        <div className="tabs" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
          {TABS.map((t) => {
            const I = Icon[t.icon];
            const active = route === t.to;
            return (
              <button key={t.to} type="button" onClick={() => go(t.to)} className={`tab ${active ? "on" : ""}`} aria-label={t.label} aria-current={active ? "page" : undefined}>
                <I width={24} height={24} strokeWidth={active ? 2.2 : 1.8} />
                {t.badge && <span className="badge" />}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
