import { randomBytes } from "node:crypto";
import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, run } from "@/lib/db";
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_HELP, type Provider } from "@/lib/integrations";
import { baseUrl } from "@/lib/template";

export const OPTIONS = preflight;

function shape(row: Record<string, unknown>) {
  const provider = String(row.provider) as Provider;
  return {
    id: Number(row.id),
    provider,
    label: PROVIDER_LABELS[provider],
    help: PROVIDER_HELP[provider],
    url: `${baseUrl()}/api/hooks/${provider}/${row.token}`,
    has_secret: Boolean(row.signing_secret),
    enabled: Boolean(row.enabled),
    events: Number(row.events),
    last_event_at: String(row.last_event_at ?? ""),
    created_at: String(row.created_at),
  };
}

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const rows = await all("SELECT * FROM integrations WHERE business_id=? ORDER BY id", [b.id]);
  return json({
    integrations: rows.map(shape),
    providers: PROVIDERS.map((p) => ({ provider: p, label: PROVIDER_LABELS[p], help: PROVIDER_HELP[p] })),
  });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { provider, signing_secret } = await body<{ provider?: string; signing_secret?: string }>(req);
  if (!PROVIDERS.includes(provider as Provider)) return fail("Unknown provider");
  const token = randomBytes(18).toString("base64url");
  const { lastId } = await run("INSERT INTO integrations (business_id, provider, token, signing_secret) VALUES (?,?,?,?)", [
    b.id,
    provider!,
    token,
    (signing_secret ?? "").trim(),
  ]);
  const rows = await all("SELECT * FROM integrations WHERE id=?", [lastId]);
  return json({ integration: shape(rows[0]) }, 201);
}
