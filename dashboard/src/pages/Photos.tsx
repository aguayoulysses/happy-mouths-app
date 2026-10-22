import { useCallback, useEffect, useRef, useState } from "react";
import { api, del, upload } from "../lib/api";
import { Masthead, EmptyRow } from "../ui/bits";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { shrink } from "../lib/image";
import { shortDate } from "../lib/format";
import { tap, success } from "../lib/native";

type Photo = { id: number; url: string; status: "posted" | "waiting"; posted_at: string; created_at: string };
type Resp = { every_days: number; google_linked: boolean; photos: Photo[] };

/** Job photos for the Google profile. Upload a batch; they go up one at a time so the profile always looks fresh. */
export function Photos({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Photo | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(() => {
    api<Resp>("/api/v1/photos").then(setData).catch(() => setData((d) => d ?? { every_days: 3, google_linked: false, photos: [] }));
  }, []);
  useEffect(load, [load]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 30);
    setError("");
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        const form = new FormData();
        form.append("photo", await shrink(list[i]), "photo.jpg");
        await upload("/api/v1/photos", form);
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (failed) setError(`${failed} photo${failed === 1 ? "" : "s"} did not upload. Try again.`);
    else {
      success();
      toast(list.length === 1 ? "Photo added" : `${list.length} photos added`);
    }
    load();
  }

  async function remove(p: Photo) {
    try {
      await del(`/api/v1/photos/${p.id}`);
      setPicked(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove it");
    }
  }

  const waiting = data?.photos.filter((p) => p.status === "waiting").length ?? 0;
  const live = data?.photos.filter((p) => p.status === "posted").length ?? 0;

  return (
    <>
      <Masthead />
      <button type="button" onClick={() => { tap(); onBack(); }} className="-ml-1.5 mt-4 flex items-center gap-0.5 text-[15px] font-semibold text-ink-soft md:mt-2"><Icon.back width={20} height={20} strokeWidth={2.3} />Home</button>
      <h1 className="h-page mt-2">Photos</h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">Add photos of your work. We put them on your Google profile one at a time, a new one every {data?.every_days ?? 3} days, so your profile always looks active.</p>

      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <button type="button" disabled={!!progress} onClick={() => { tap(); file.current?.click(); }} className="btn btn-sun mt-4 h-13 w-full gap-2 text-[16px]">
        <Icon.camera width={20} height={20} />{progress ? `Uploading ${progress.done} of ${progress.total}…` : "Add photos"}
      </button>
      {error && <p className="mt-3 text-[14px] font-semibold text-cherry">{error}</p>}
      {data && !data.google_linked && <p className="mt-3 text-[13px] text-ink-mute">Your Google profile is not connected yet. Photos you add now wait here and start going up once we connect it.</p>}

      {data && data.photos.length > 0 && <p className="mt-6 px-1 text-[14px] font-semibold text-ink-soft">{live} on Google{waiting ? `, ${waiting} waiting their turn` : ""}</p>}
      {data?.photos.length === 0 && <div className="group mt-6"><EmptyRow title="No photos yet" body="Finished jobs, before and afters, your crew, your truck. Real photos from your phone are what customers want to see." /></div>}
      <div className="photo-grid mt-3">
        {data?.photos.map((p) => (
          <button key={p.id} type="button" className="photo-tile" onClick={() => { tap(); setPicked(p); }}>
            <img src={p.url} alt="" loading="lazy" />
            <span className={`tag ${p.status === "posted" ? "live" : ""}`}>{p.status === "posted" ? "On Google" : "Waiting"}</span>
          </button>
        ))}
      </div>

      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked?.status === "posted" ? "On your Google profile" : "Waiting its turn"}>
        {picked && (
          <>
            <img src={picked.url} alt="" className="mt-3 max-h-72 w-full rounded-xl object-contain" />
            <p className="mt-3 text-[14px] text-ink-soft">{picked.status === "posted" ? `Went up ${shortDate(picked.posted_at)}.` : `Added ${shortDate(picked.created_at)}. It goes up when its turn comes.`}</p>
            <div className="mt-4 grid gap-2">
              {picked.status === "waiting" && <button type="button" onClick={() => remove(picked)} className="btn h-12 bg-cherry text-white">Remove this photo</button>}
              <button type="button" onClick={() => setPicked(null)} className="btn btn-ghost h-12">Close</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
