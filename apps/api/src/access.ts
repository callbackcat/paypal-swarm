import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Judge access gate. A run that spends the server's own OpenRouter key needs the access code, sent as X-Access-Code.
 * The code is the SWARM_ACCESS_CODE environment variable on the server and is never in the repository. With the
 * variable unset the gate is off. Scripted runs and runs on a bring-your-own key are never gated.
 */
export const ACCESS_HEADER = "X-Access-Code";

const expected = () => process.env.SWARM_ACCESS_CODE?.trim() || undefined;
const sha = (value: string) => createHash("sha256").update(value).digest();

export const accessGateOn = () => !!expected();

export function accessCodeOk(code: string | undefined | null): boolean {
  const want = expected();
  if (!want) return true;
  const value = code?.trim();
  if (!value || value.length > 200) return false;
  return timingSafeEqual(sha(value), sha(want));
}
