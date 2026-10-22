"use client";

import { createContext, useContext, type ReactNode } from "react";
import { makeT, type Lang, type T } from "@/lib/i18n";

const Ctx = createContext<T>(makeT("en"));

/** Hands the viewer's language to every client component under the ops shell. */
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <Ctx.Provider value={makeT(lang)}>{children}</Ctx.Provider>;
}

export function useT(): T {
  return useContext(Ctx);
}
