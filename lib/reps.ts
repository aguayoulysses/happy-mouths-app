// The people an owner talks to in the team chat. One of us is every
// business's named person, so the chat always has a face. Edit the "team" list in brand.json.

import { BRAND } from "@/lib/whitelabel";

export type Rep = { key: string; name: string; title: string; photo: string };

export const REPS: Rep[] = BRAND.team;

export function repFor(key: string | null | undefined): Rep {
  return REPS.find((r) => r.key === key) ?? REPS[0];
}
