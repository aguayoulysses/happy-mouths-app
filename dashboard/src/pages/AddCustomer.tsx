import { useState, type FormEvent } from "react";
import { Sheet } from "../ui/Sheet";
import { post } from "../lib/api";
import { success, warn } from "../lib/native";
import { useToast } from "../ui/Toast";

export function AddCustomerSheet({ open, onClose, onAdded, delay }: { open: boolean; onClose: () => void; onAdded: () => void; delay: number }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await post<{ outcome: string }>("/api/v1/customers", { name, phone });
      success();
      toast(r.outcome === "already_active" ? `${name || "They"} already have a request going` : "Scheduled");
      setName("");
      setPhone("");
      onAdded();
      onClose();
    } catch (err) {
      warn();
      setError(err instanceof Error ? err.message : "Couldn't add them");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a customer">
      <p className="mt-1 text-sm text-ink-soft">They&rsquo;ll get a review text a little after their visit, with a gentle follow-up or two if they don&rsquo;t leave one.</p>
      <form onSubmit={(e) => submit(e)} className="mt-4 grid gap-3">
        <input className="field" placeholder="Name" autoComplete="off" autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="field" placeholder="Mobile number" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        {error && <p className="text-sm font-semibold text-cherry">{error}</p>}
        <button className="btn btn-ink mt-1 h-12" disabled={busy || !phone}>Add customer</button>
      </form>
    </Sheet>
  );
}

export function ImportSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ total: number; skipped: number; preview: { name: string; phone: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  async function check() {
    setBusy(true);
    setError("");
    try {
      setPreview(await post("/api/v1/customers/import", { text, dry: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that");
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    try {
      const r = await post<{ queued: number; already_active: number; already_reviewed?: number; opted_out: number; do_not_contact: number; invalid_phone: number }>("/api/v1/customers/import", { text });
      success();
      toast(`${r.queued} scheduled${r.already_active ? `, ${r.already_active} already active` : ""}${r.already_reviewed ? `, ${r.already_reviewed} already reviewed you` : ""}${r.do_not_contact ? `, ${r.do_not_contact} on do not contact` : ""}${r.invalid_phone ? `, ${r.invalid_phone} skipped` : ""}`);
      setText("");
      setPreview(null);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  async function pickFile(file: File) {
    setText(await file.text());
    setPreview(null);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a list">
      <p className="mt-1 text-sm text-ink-soft">Paste names and numbers, or choose a CSV from your booking or POS system. One customer per line.</p>
      <textarea className="field mt-4" rows={6} placeholder={"Maria Lopez, 714-555-0142\nJ. Chen 9495550188"} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
      <label className="btn btn-soft btn-sm mt-2 cursor-pointer">
        Choose a file
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
      </label>
      {error && <p className="mt-2 text-sm font-semibold text-cherry">{error}</p>}
      {preview && (
        <div className="mt-4 rounded-lg bg-ground p-3 text-[14px]">
          <p className="font-bold">{preview.total} customer{preview.total === 1 ? "" : "s"} found{preview.skipped ? `, ${preview.skipped} line${preview.skipped === 1 ? "" : "s"} skipped (no valid mobile number)` : ""}</p>
          <ul className="mt-1 max-h-32 overflow-y-auto text-ink-soft">
            {preview.preview.slice(0, 8).map((p, i) => <li key={i}>{p.name || "(no name)"} · {p.phone}</li>)}
            {preview.total > 8 && <li>…and {preview.total - 8} more</li>}
          </ul>
        </div>
      )}
      <div className="mt-4 grid gap-2">
        {!preview ? (
          <button type="button" onClick={check} className="btn btn-ink h-12" disabled={busy || !text.trim()}>Check the list</button>
        ) : (
          <button type="button" onClick={run} className="btn btn-ink h-12" disabled={busy || !preview.total}>Schedule {preview.total} request{preview.total === 1 ? "" : "s"}</button>
        )}
      </div>
    </Sheet>
  );
}
