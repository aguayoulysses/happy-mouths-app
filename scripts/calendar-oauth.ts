// One-time: lets the app put support phone calls on the rep's Google
// Calendar. Same Google Cloud OAuth app as the Business Profile link, but a
// separate refresh token with only the calendar.events scope, minted by the
// Google account whose calendar the calls should land on.
//
// Run:  npx -y tsx --env-file=../client-pulse/.env.local scripts/calendar-oauth.ts
// It opens the consent page, then writes GOOGLE_CALENDAR_REFRESH_TOKEN (and the
// OAuth client id/secret if missing) into .env.local. Nothing secret is printed.
// Afterwards add the same GOOGLE_CALENDAR_REFRESH_TOKEN to the Vercel project.

import http from "node:http";
import fs from "node:fs";
import { execFile } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 5391; // same redirect the Business Profile bootstrap registered
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const ENV_FILE = ".env.local";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first (use --env-file).");
  process.exit(1);
}

function upsertEnv(pairs: Record<string, string>) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent",
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") return void res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "content-type": "text/html" }).end(`<h2>Google did not approve: ${url.searchParams.get("error") ?? "no code"}</h2>`);
    console.log("RESULT: denied", url.searchParams.get("error") ?? "");
    process.exit(1);
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!token.refresh_token) {
    res.writeHead(200, { "content-type": "text/html" }).end("<h2>Something went wrong. Go back to Claude.</h2>");
    console.log("RESULT: token exchange failed:", token.error, token.error_description);
    process.exit(1);
  }
  upsertEnv({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID!, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET!, GOOGLE_CALENDAR_REFRESH_TOKEN: token.refresh_token });

  // Smoke test: can we read the calendar this token belongs to?
  const test = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&singleEvents=true&timeMin=" + encodeURIComponent(new Date().toISOString()), { headers: { authorization: `Bearer ${token.access_token}` } });
  const body = (await test.json().catch(() => ({}))) as { summary?: string; error?: { message?: string; status?: string } };
  res.writeHead(200, { "content-type": "text/html" }).end(`<h2 style="font-family:system-ui">${test.ok ? "Calendar connected. You can close this tab." : "Approved, but the Calendar API needs to be switched on. Go back to Claude."}</h2>`);
  console.log(test.ok ? `RESULT: connected, calendar "${body.summary}". Token saved to ${ENV_FILE}.` : `RESULT: token saved, but the calendar test failed: ${test.status} ${body.error?.status ?? ""} ${body.error?.message ?? ""}`);
  server.close();
  process.exit(test.ok ? 0 : 2);
});

server.listen(PORT, () => {
  console.log("Opening Google's approval page in your browser…");
  execFile("open", [authUrl]);
});
setTimeout(() => { console.log("RESULT: timed out waiting for approval"); process.exit(3); }, 9 * 60 * 1000);
