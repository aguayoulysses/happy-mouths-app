// What the in-app dialer needs to place a call: a Twilio access token and the
// call key our TwiML webhook checks. Both last an hour; the app asks per call.

import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { canCallInApp, voiceAccessToken, callKey } from "@/lib/voice";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_phone) return fail("No business line on this account.", 404);
  if (!canCallInApp(b)) return fail("In-app calling is not set up for this line.", 409);
  return json({ token: voiceAccessToken(b), key: callKey(b), caller_id: b.sms_number });
}
