import { useCallback, useEffect, useMemo, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { api, post } from "./lib/api";
import { getToken, setToken, clearToken } from "./lib/auth";
import { useRoute, navigate, type Route } from "./lib/router";
import { bootNative, isNative, tap } from "./lib/native";
import { registerPush, unregisterPush } from "./lib/push";
import { Shell } from "./ui/Shell";
import { Icon } from "./ui/icons";
import { Login, Signup } from "./pages/Auth";
import { Home, type Dashboard } from "./pages/Home";
import { Customers } from "./pages/Customers";
import { Reviews } from "./pages/Reviews";
import { Settings, type Biz } from "./pages/Settings";
import { AddCustomerSheet, ImportSheet } from "./pages/AddCustomer";
import { Phone } from "./pages/Phone";
import { Team } from "./pages/Team";
import { Invoices } from "./pages/Invoices";
import { Photos } from "./pages/Photos";
import { TeamContext } from "./ui/TeamButton";
import { CallScreen, RingBackSheet } from "./ui/CallScreen";
import { useCallController } from "./lib/voice";
import { MARK, NAME } from "./brand";

const TITLES: Record<string, string> = { "/customers": "Customers", "/phone": "Phone", "/invoices": "Invoices", "/photos": "Photos", "/reviews": "Reviews", "/settings": "Settings" };

type AuthState = { status: "loading" } | { status: "out" } | { status: "in"; business: Biz };

export default function App() {
  const route = useRoute();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [dial, setDial] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [textUnread, setTextUnread] = useState(0);
  const [teamUnread, setTeamUnread] = useState(0);
  const feats = auth.status === "in" ? auth.business.features : undefined;
  const canCall = !!feats?.phone;
  const hasPhone = !!feats?.phone || !!feats?.messages;
  const voice = useCallController(canCall);
  const rep = auth.status === "in" ? (auth.business.rep ?? null) : null;
  const team = useMemo(() => ({ rep, unread: teamUnread }), [rep, teamUnread]);
  const onTeamRead = useCallback(() => setTeamUnread(0), []);

  // The dot on the "Message <name>" button: check for replies from us without marking them read.
  useEffect(() => {
    if (auth.status !== "in") return;
    const check = () => api<{ unread: number }>("/api/v1/team?peek=1").then((r) => setTeamUnread(r.unread)).catch(() => {});
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [auth.status]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    await post("/api/v1/logout").catch(() => {});
    await clearToken();
    setAuth({ status: "out" });
    navigate("/login", true);
  }, []);

  // <urlScheme>://login?token=… (admin hand-off, TestFlight demo) and future push deep links.
  useEffect(() => {
    if (!isNative) return;
    const handle = async (url: string) => {
      const u = new URL(url);
      const t = u.searchParams.get("token");
      if (u.host === "go") {
        const to = u.searchParams.get("to") ?? "/";
        navigate((["/", "/customers", "/phone", "/reviews", "/settings", "/team", "/invoices", "/photos"].includes(to) ? to : "/") as Route);
        return;
      }
      if (u.host === "login" && t) {
        await setToken(t);
        try {
          const r = await api<{ business: Biz }>("/api/v1/me");
          setAuth({ status: "in", business: r.business });
          navigate("/", true);
        } catch {
          /* bad token, stay where we are */
        }
      }
    };
    CapApp.getLaunchUrl().then((l) => { if (l?.url) handle(l.url); }).catch(() => {});
    const sub = CapApp.addListener("appUrlOpen", (e) => handle(e.url));
    return () => {
      sub.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    bootNative();
    (async () => {
      // Admin "open their dashboard" lands here with ?token=; adopt it and clean the URL.
      const url = new URL(window.location.href);
      const t = url.searchParams.get("token");
      if (t) {
        await setToken(t);
        url.searchParams.delete("token");
        window.history.replaceState(null, "", url.pathname);
      }
      if (!(await getToken())) {
        setAuth({ status: "out" });
        if (route !== "/signup") navigate("/login", true);
        return;
      }
      try {
        const [r] = await Promise.all([api<{ business: Biz }>("/api/v1/me"), new Promise((ok) => setTimeout(ok, 750))]);
        setAuth({ status: "in", business: r.business });
        if (route === "/login" || route === "/signup") navigate("/", true);
      } catch {
        setAuth({ status: "out" });
        navigate("/login", true);
      }
    })();
    const onOut = () => {
      setAuth({ status: "out" });
      navigate("/login", true);
    };
    window.addEventListener("hm:signout", onOut);
    return () => window.removeEventListener("hm:signout", onOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (auth.status !== "in") return;
    registerPush((o) => {
      if (o.kind === "review") navigate("/reviews");
      else if (o.kind === "call") {
        if (o.phone) setDial(o.phone);
        navigate("/phone");
      } else if (o.kind === "text") {
        if (o.phone) setOpenThread(o.phone);
        navigate("/phone");
      } else if (o.kind === "team") navigate("/team");
      else if (o.kind === "customers") navigate("/customers");
      else if (o.kind === "photos") navigate("/photos");
      else navigate("/");
      setRefresh((n) => n + 1);
    });
  }, [auth.status]);

  if (auth.status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas">
        <div className="flex flex-col items-center">
          <img src={MARK} alt="" width={84} height={84} className="launch-mascot" />
          <span className="launch-word">{NAME}</span>
        </div>
      </div>
    );
  }

  const onAuthed = (b: unknown) => setAuth({ status: "in", business: b as Biz });
  if (auth.status === "out") {
    return (
      <div className="min-h-dvh bg-canvas">
        {route === "/signup" && !isNative ? <Signup onAuthed={onAuthed} /> : <Login onAuthed={onAuthed} />}
      </div>
    );
  }

  const b = auth.business;
  const bump = () => setRefresh((n) => n + 1);
  const onStats = (_d: Dashboard) => {};

  const home = <Home business={b} onAdd={() => setAdd(true)} onImport={() => setImp(true)} refreshKey={refresh} onStats={onStats} />;
  return (
    <TeamContext.Provider value={team}>
    <Shell business={b.name} phone={hasPhone} badge={textUnread > 0} title={route === "/" ? b.name : (TITLES[route] ?? b.name)}>
      {(route === "/" || route === "/team") && home}
      {route === "/customers" && <Customers onAdd={() => setAdd(true)} onImport={() => setImp(true)} refreshKey={refresh} />}
      {route === "/phone" && (hasPhone ? <Phone feat={{ phone: canCall, messages: !!feats?.messages }} dial={dial} onDialed={() => setDial(null)} openThread={openThread} onThreadOpened={() => setOpenThread(null)} onUnread={setTextUnread} /> : home)}
      {route === "/invoices" && (feats?.invoices ? <Invoices businessName={b.name} onBack={() => navigate("/")} /> : home)}
      {route === "/photos" && (feats?.photos ? <Photos onBack={() => navigate("/")} /> : home)}
      {route === "/team" && rep && <Team rep={rep} onBack={() => window.history.length > 1 && !isNative ? window.history.back() : navigate("/")} onRead={onTeamRead} />}
      {route === "/reviews" && <Reviews business={b} />}
      {route === "/settings" && <Settings business={b} onSaved={(nb) => setAuth({ status: "in", business: nb })} onSignOut={signOut} />}

      {(route === "/" || route === "/customers") && (
        <button
          type="button"
          onClick={() => { tap(); setAdd(true); }}
          className="btn btn-sun btn-pill fixed right-4 z-30 h-13 gap-1.5 pl-4 pr-5 md:hidden"
          style={{ bottom: "calc(var(--tabbar-h) + var(--sab) + 16px)" }}
          aria-label="Add a customer"
        >
          <Icon.plus width={20} height={20} strokeWidth={2.4} />
          <span className="text-[14px]">Add customer</span>
        </button>
      )}

      <AddCustomerSheet open={add} onClose={() => setAdd(false)} onAdded={bump} delay={b.delay_minutes} />
      <ImportSheet open={imp} onClose={() => setImp(false)} onDone={bump} />
      <RingBackSheet target={voice.fallback} onClose={voice.closeFallback} />
      {voice.call && <CallScreen call={voice.call} onHangup={voice.hangup} onMute={voice.setMuted} onSpeaker={voice.setSpeaker} onDigit={voice.digits} />}
    </Shell>
    </TeamContext.Provider>
  );
}
