import { businessFromRequest, type Business } from "./auth";
import { fail } from "./api";

/** Resolve the signed-in business or produce the 401 the route should return. */
export async function requireBusiness(req: Request): Promise<{ b: Business; res: null } | { b: null; res: Response }> {
  const b = await businessFromRequest(req);
  if (!b) return { b: null, res: fail("Sign in required", 401) };
  return { b, res: null };
}
