// One-time: the agency's Google Business Profile link (reviews, replies, photos,
// performance numbers). Sign in with the Google account that manages the
// clients' profiles.
//
// Run:  npx -y tsx --env-file=../client-pulse/.env.local scripts/gbp-oauth.ts
// It opens the consent page, then writes GBP_REFRESH_TOKEN into .env.local and
// lists every profile the account can manage. Nothing secret is printed.
// Afterwards add the same GBP_REFRESH_TOKEN to the Vercel project.

import http from "node:http";
import fs from "node:fs";
import { execFile } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 5391; // same redirect the Business Profile bootstrap registered
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/business.manage";
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
  upsertEnv({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID!, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET!, GBP_REFRESH_TOKEN: token.refresh_token });

  // Smoke test: every account and profile this sign-in can manage (ids are not secret).
  const auth = { authorization: `Bearer ${token.access_token}` };
  const accounts = (await (await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: auth })).json()) as { accounts?: { name: string; accountName: string; type: string }[]; error?: { message?: string } };
  const ok = Boolean(accounts.accounts?.length);
  res.writeHead(200, { "content-type": "text/html" }).end(`<h2 style="font-family:system-ui">${ok ? "Business Profiles connected. You can close this tab." : "Approved, but no profiles were found. Go back to Claude."}</h2>`);
  if (!ok) console.log("RESULT: token saved, but no accounts visible:", accounts.error?.message ?? "");
  for (const account of accounts.accounts ?? []) {
    console.log(`ACCOUNT ${account.name} (${account.accountName}, ${account.type})`);
    const locs = (await (await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`, { headers: auth })).json()) as { locations?: { name: string; title: string }[]; error?: { message?: string } };
    if (locs.error) console.log("  locations error:", locs.error.message);
    for (const l of locs.locations ?? []) console.log(`  ${l.name}  ${l.title}`);
  }
  if (ok) console.log(`RESULT: connected. Token saved to ${ENV_FILE}.`);
  server.close();
  process.exit(ok ? 0 : 2);
});

server.listen(PORT, () => {
  console.log("Opening Google's approval page in your browser…");
  execFile("open", [authUrl]);
});
setTimeout(() => { console.log("RESULT: timed out waiting for approval"); process.exit(3); }, 9 * 60 * 1000);
