/**
 * The access code for live runs. The api asks for it (401) when a run would spend the demo OpenRouter key; the
 * AccessGate dialog in the root layout collects it once, and it stays in this browser.
 */
const KEY = "swarm.accessCode";

export const ACCESS_HEADER = "X-Access-Code";

export function storedAccessCode(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function storeAccessCode(code: string | null) {
  try {
    if (code) window.localStorage.setItem(KEY, code);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private window: the code lasts for this page only */
  }
}

type Asker = () => Promise<boolean>;
let asker: Asker | null = null;

/** The mounted dialog registers itself here. */
export function registerAccessAsker(fn: Asker) {
  asker = fn;
  return () => {
    if (asker === fn) asker = null;
  };
}

/** Opens the access dialog. Resolves true once a code was checked and stored, false when the person backed out. */
export const askForAccessCode = (): Promise<boolean> => (asker ? asker() : Promise.resolve(false));
