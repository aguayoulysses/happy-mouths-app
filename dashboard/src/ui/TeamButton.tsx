import { createContext, useContext } from "react";
import { navigate } from "../lib/router";
import { tap } from "../lib/native";
import { API_BASE } from "../lib/api";

export type Rep = { key: string; name: string; title: string; photo: string };
export const TeamContext = createContext<{ rep: Rep | null; unread: number }>({ rep: null, unread: 0 });

export const repPhoto = (rep: Rep) => (rep.photo.startsWith("/") ? `${API_BASE}${rep.photo}` : rep.photo);

/** The way to reach us: a face and a name, not a help desk. Opens the saved chat with that person. */
export function TeamButton({ className = "" }: { className?: string }) {
  const { rep, unread } = useContext(TeamContext);
  if (!rep) return null;
  return (
    <button type="button" onClick={() => { tap(); navigate("/team"); }} className={`team-btn ${className}`} aria-label={`Message ${rep.name}`}>
      <span className="relative">
        <img src={repPhoto(rep)} alt="" className="h-7 w-7 rounded-full border border-line object-cover" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-cherry" />}
      </span>
      <span>Message {rep.name}</span>
    </button>
  );
}
