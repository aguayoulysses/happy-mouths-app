import { setLang } from "./actions";
import type { Lang } from "@/lib/i18n";

// One button: shows the language you are NOT in, press it to switch. The choice is a cookie,
// so it sticks per browser, like the sign-in.
export function LangToggle({ lang, className = "" }: { lang: Lang; className?: string }) {
  const next: Lang = lang === "es" ? "en" : "es";
  return (
    <form action={setLang} className={`lang-toggle ${className}`}>
      <input type="hidden" name="lang" value={next} />
      <button type="submit" aria-label={next === "es" ? "Cambiar a español" : "Switch to English"} title={next === "es" ? "Español" : "English"}>
        <span className={lang === "en" ? "on" : ""}>EN</span>
        <span className="sep">/</span>
        <span className={lang === "es" ? "on" : ""}>ES</span>
      </button>
    </form>
  );
}
