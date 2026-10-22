import { useRef, useState, type FormEvent } from "react";
import { api, post, ApiError } from "../lib/api";
import { setToken } from "../lib/auth";
import { navigate } from "../lib/router";
import { isNative, success } from "../lib/native";
import { MARK, NAME } from "../brand";

type Biz = Record<string, unknown>;

export function Login({ onAuthed }: { onAuthed: (b: Biz) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Runs from the form submit AND straight from the button's touch/click, so a
  // tap still signs in when the webview drops the click (keyboard closing under
  // the finger, iPhone-on-iPad scaling). `running` keeps the two from doubling up.
  const running = useRef(false);
  async function signIn() {
    if (running.current) return;
    const mail = email.trim();
    if (!mail || !password) {
      setError("Enter your email and password.");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 20000);
    try {
      const r = await api<{ token: string; business: Biz }>("/api/v1/login", { method: "POST", body: JSON.stringify({ email: mail, password }), signal: stop.signal });
      await setToken(r.token);
      success();
      onAuthed(r.business);
      navigate("/", true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't reach ${NAME}. Check your connection and try again.`);
    } finally {
      clearTimeout(timer);
      running.current = false;
      setBusy(false);
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn();
  };

  return (
    <AuthFrame title="Welcome back" sub={`Sign in to your ${NAME} account.`}>
      <form onSubmit={submit} noValidate className="mt-6 grid gap-3">
        <input className="field" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm font-semibold text-cherry">{error}</p>}
        <button type="submit" className="btn btn-ink mt-1 h-12" disabled={busy} onTouchEnd={(e) => { e.preventDefault(); signIn(); }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      {!isNative && (
        <p className="mt-6 text-center text-sm text-ink-soft">
          New here? <button type="button" onClick={() => navigate("/signup")} className="font-bold text-ink underline">Start your free month</button>
        </p>
      )}
    </AuthFrame>
  );
}

export function Signup({ onAuthed }: { onAuthed: (b: Biz) => void }) {
  const [f, setF] = useState({ business: "", owner: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await post<{ token: string; business: Biz }>("/api/v1/signup", f);
      await setToken(r.token);
      success();
      onAuthed(r.business);
      navigate("/", true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Start your free month" sub="Takes a minute. No card needed.">
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <input className="field" placeholder="Business name" value={f.business} onChange={set("business")} required />
        <input className="field" placeholder="Your name" autoComplete="name" value={f.owner} onChange={set("owner")} />
        <input className="field" type="email" autoComplete="email" inputMode="email" placeholder="Email" value={f.email} onChange={set("email")} required />
        <input className="field" type="tel" autoComplete="tel" inputMode="tel" placeholder="Your cell (for alerts)" value={f.phone} onChange={set("phone")} />
        <input className="field" type="password" autoComplete="new-password" placeholder="Password (8+ characters)" value={f.password} onChange={set("password")} required minLength={8} />
        {error && <p className="text-sm font-semibold text-cherry">{error}</p>}
        <button className="btn btn-ink mt-1 h-12" disabled={busy}>Create my account</button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        Already have one? <button type="button" onClick={() => navigate("/login")} className="font-bold text-ink underline">Sign in</button>
      </p>
    </AuthFrame>
  );
}

function AuthFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      <img src={MARK} alt="" width={64} height={64} className="mb-5" />
      <h1 className="h-page">{title}</h1>
      <p className="mt-1.5 text-ink-soft">{sub}</p>
      {children}
    </main>
  );
}
