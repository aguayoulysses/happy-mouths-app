import { cookies } from "next/headers";
import { cache } from "react";
import { asLang, LANG_COOKIE, makeT, type Lang, type T } from "./i18n";

/** The language this viewer picked with the toggle in the sidebar. English until they do. */
export const currentLang = cache(async (): Promise<Lang> => {
  const jar = await cookies();
  return asLang(jar.get(LANG_COOKIE)?.value);
});

/** t() for server components and actions. */
export async function tr(): Promise<T> {
  return makeT(await currentLang());
}
