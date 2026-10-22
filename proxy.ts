// ops.<your domain> is the team's side of the app: the same app, opened
// straight onto the ops board. It also keeps a signed-in team member signed in:
// every ops visit re-issues their session cookie for another 400 days (the most
// a browser allows), so one sign-in per device is all anyone ever does.

import { NextResponse, type NextRequest } from "next/server";

const OPS_COOKIE = "hm_ops";

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  let res: NextResponse;
  if ((host.startsWith("ops.") || host.startsWith("ops-demo.")) && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    res = NextResponse.rewrite(url);
  } else {
    res = NextResponse.next();
  }
  const token = req.cookies.get(OPS_COOKIE)?.value;
  if (token) res.cookies.set(OPS_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 400 });
  return res;
}

export const config = { matcher: ["/", "/admin/:path*"] };
