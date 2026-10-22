// A very small router. On the web it uses real URLs under /app/. Inside the
// iOS bundle (file:// or capacitor://) there is no meaningful URL, so it just
// keeps the route in memory. Same API either way.

import { useEffect, useState } from "react";
import { isNative } from "./native";

export type Route = "/" | "/customers" | "/phone" | "/reviews" | "/settings" | "/team" | "/invoices" | "/photos" | "/login" | "/signup";
const ROUTES: Route[] = ["/", "/customers", "/phone", "/reviews", "/settings", "/team", "/invoices", "/photos", "/login", "/signup"];

const BASE = "/app";
let current: Route = readRoute();
const listeners = new Set<() => void>();

function readRoute(): Route {
  if (isNative) return "/";
  let p = window.location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
  p = p.replace(/\/+$/, "") || "/";
  return (ROUTES as string[]).includes(p) ? (p as Route) : "/";
}

export function navigate(to: Route, replace = false) {
  if (to === current) return;
  current = to;
  if (!isNative) {
    const url = `${BASE}${to === "/" ? "/" : to}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }
  window.scrollTo({ top: 0 });
  listeners.forEach((l) => l());
}

if (!isNative) {
  window.addEventListener("popstate", () => {
    current = readRoute();
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
