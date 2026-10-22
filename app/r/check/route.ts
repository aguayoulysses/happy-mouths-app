// A fixed answer the daily site check looks for through the client's own domain:
// theirsite.com/review/check must rewrite to here. If it does not, their review link is broken.
export function GET() {
  return new Response("happy-mouths-gate-ok", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
