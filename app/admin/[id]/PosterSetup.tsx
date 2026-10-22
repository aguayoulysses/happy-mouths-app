"use client";

// Client onboarding for pictures, in three numbered steps: the blank-sign photo (click its four
// corners), the follow-up meme photo, then a real test text. Photos are shrunk in the browser,
// which also applies the phone's rotation, so what is clicked is what gets stored.

import { useEffect, useRef, useState } from "react";
import { useT } from "../LangProvider";

type Pt = [number, number];
type Kind = "sign" | "caption";

const MAX_SIDE = 1600;

async function post(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/admin/poster", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function Picker({ businessId, kind, current, defaultCaption, sentId = 0 }: { businessId: number; kind: Kind; current: string; defaultCaption: string; sentId?: number }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [caption, setCaption] = useState(defaultCaption);
  const [name, setName] = useState("Anika");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(current);
  const [stamp, setStamp] = useState(0);

  async function choose(file: Blob | undefined) {
    if (!file) return;
    setMsg("");
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    setImg(c);
    setPts([]);
    setPreview("");
  }

  // Draw the photo with the clicked corners on top.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !img) return;
    el.width = img.width;
    el.height = img.height;
    const ctx = el.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    if (kind !== "sign" || !pts.length) return;
    const r = Math.max(8, img.width * 0.008);
    ctx.lineWidth = r * 0.6;
    ctx.strokeStyle = "#fd4347";
    ctx.fillStyle = "#fd4347";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (pts.length === 4) ctx.closePath();
    ctx.stroke();
    pts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); });
  }, [img, pts, kind]);

  function click(e: React.MouseEvent<HTMLCanvasElement>) {
    if (kind !== "sign" || !img || pts.length >= 4) return;
    const box = e.currentTarget.getBoundingClientRect();
    setPts([...pts, [Math.round(((e.clientX - box.left) / box.width) * img.width), Math.round(((e.clientY - box.top) / box.height) * img.height)]]);
    setPreview("");
  }

  const ready = img && (kind === "caption" || pts.length === 4);
  const payload = () => ({ business_id: businessId, kind, image: img!.toDataURL("image/jpeg", 0.9), quad: pts, caption, name });

  async function go(action: "preview" | "save") {
    if (!ready) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await post({ action, ...payload() });
      if (!res.ok) throw new Error((await res.json()).error ?? t("Something went wrong"));
      if (action === "preview") setPreview(URL.createObjectURL(await res.blob()));
      else {
        const j = (await res.json()) as { key: string };
        setSaved(j.key);
        setStamp(Date.now());
        setImg(null);
        setPts([]);
        setPreview("");
        setMsg(t("Saved. This is what customers get now."));
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  /** Load the photo the client sent from their finish page, then the corners get clicked like any upload. */
  async function useSent() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/poster?raw=${sentId}`);
      if (!res.ok) throw new Error(t("Something went wrong"));
      await choose(await res.blob());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await post({ action: "remove", business_id: businessId, kind });
    setSaved("");
    setMsg(t("Removed. Texts for this step go out with words only."));
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-extrabold">{kind === "sign" ? t("1. Sign photo (first text)") : t("2. Meme photo (first follow-up)")}</h3>
        {saved && !img && <button type="button" onClick={remove} className="text-xs font-bold text-cherry hover:underline">{t("Remove")}</button>}
      </div>
      <p className="mt-1 text-xs text-ink-mute">
        {kind === "sign"
          ? t("Their team holding a blank white board, flat to the camera, fingers on the edges only. We write each customer's first name on it.")
          : t("Someone from their team looking heartbroken, head near the top of the frame. The caption is printed across the bottom.")}
      </p>

      {saved && !img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/admin/poster?key=${encodeURIComponent(saved)}&name=Anika&s=${stamp}`} alt={t("Current picture with a sample name")} className="mt-3 max-h-80 rounded-lg border border-line" />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="btn btn-ghost inline-flex h-10 cursor-pointer text-sm">
          {saved ? t("Replace the photo") : t("Upload the photo")}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        {sentId > 0 && !img && (
          <button type="button" disabled={busy} onClick={useSent} className="btn btn-sun h-10 text-sm">{t("Use the photo the client sent")}</button>
        )}
      </div>

      {img && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            {kind === "sign" && (
              <p className="mb-2 text-sm font-bold">
                {pts.length < 4 ? t("Click corner {n} of 4 on the board (any order)", { n: pts.length + 1 }) : t("All four corners set")}
                {pts.length > 0 && <button type="button" onClick={() => { setPts(pts.slice(0, -1)); setPreview(""); }} className="ml-3 text-xs font-bold text-cherry hover:underline">{t("Undo")}</button>}
              </p>
            )}
            <canvas ref={canvasRef} onClick={click} className={`w-full rounded-lg border border-line ${kind === "sign" && pts.length < 4 ? "cursor-crosshair" : ""}`} />
          </div>
          <div>
            {kind === "caption" && (
              <label className="block">
                <span className="text-xs font-bold text-ink-soft">{t("Caption ({name} = customer’s first name)")}</span>
                <input className="field mt-1" value={caption} onChange={(e) => { setCaption(e.target.value); setPreview(""); }} />
              </label>
            )}
            <label className="mt-2 block">
              <span className="text-xs font-bold text-ink-soft">{t("Try a name")}</span>
              <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={!ready || busy} onClick={() => go("preview")} className="btn btn-ghost h-10 text-sm">{t("Preview")}</button>
              <button type="button" disabled={!ready || busy || !preview} onClick={() => go("save")} className="btn btn-sun h-10 text-sm">{t("Looks right, save it")}</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt={t("Preview")} className="mt-3 max-h-96 rounded-lg border border-line" />}
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm font-semibold text-ink-soft">{msg}</p>}
    </div>
  );
}

function TestSend({ businessId, defaultPhone }: { businessId: number; defaultPhone: string }) {
  const t = useT();
  const [phone, setPhone] = useState(defaultPhone);
  const [name, setName] = useState("Anika");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      const res = await post({ action: "test", business_id: businessId, phone, name });
      const j = (await res.json()) as { error?: string; steps?: number };
      if (!res.ok) throw new Error(j.error ?? t("Couldn't send"));
      setMsg(j.error ? t("First text sent. Follow-up problem: {err}", { err: j.error }) : t.n(j.steps ?? 0, "Sent {n} step to {phone}. Each one is a text, then its picture. Nothing further will go to this number.", "Sent {n} steps to {phone}. Each one is a text, then its picture. Nothing further will go to this number.", { phone }));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("Couldn't send"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="font-extrabold">{t("3. Send yourself the real thing")}</h3>
      <p className="mt-1 text-xs text-ink-mute">{t("Sends the first text and the first follow-up right now, exactly as a customer would get them, from this business’s line. Counts toward their monthly limit.")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="field w-44" placeholder={t("Your cell")} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="field w-40" placeholder={t("Name on the sign")} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" disabled={busy || !phone} onClick={send} className="btn btn-ink h-11 text-sm">{busy ? t("Sending…") : t("Send test")}</button>
      </div>
      {msg && <p className="mt-2 text-sm font-semibold text-ink-soft">{msg}</p>}
    </div>
  );
}

export function PosterSetup({ businessId, sign, meme, testPhone, sent }: { businessId: number; sign: string; meme: string; testPhone: string; sent?: { sign: number; caption: number } }) {
  const t = useT();
  return (
    <section id="pictures" className="card mt-8 p-6">
      <h2 className="font-extrabold">{t("Pictures")}</h2>
      <p className="mt-1 text-xs text-ink-mute">{t("Two photos from the client, then a test. The first text carries the sign with the customer’s name; the first follow-up carries the meme. No photo means that text goes out with words only.")}</p>
      <div className="mt-4 grid gap-4">
        <Picker businessId={businessId} kind="sign" current={sign} defaultCaption="" sentId={sent?.sign} />
        <Picker businessId={businessId} kind="caption" current={meme} defaultCaption="When {name} hasn't left me a review" sentId={sent?.caption} />
        <TestSend businessId={businessId} defaultPhone={testPhone} />
      </div>
    </section>
  );
}
