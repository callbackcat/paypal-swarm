/**
 * AG Grid and AG Studio print their trial-licence banner through `console.error`, one padded line at a time
 * (every line starts and ends with `*`). The Next dev overlay turns each line into a red "Console Error" toast,
 * which looks like a crash. While the app runs on the trial licence, drop exactly those lines and nothing else;
 * the Studio page says in words that it is on the trial licence. Idempotent; a no-op outside the browser.
 */
let installed = false;

const BANNER_LINE = /^\*[\s\S]{30,}\*$/;

export function quietLicenceBanner() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (args.length === 1 && typeof first === "string" && BANNER_LINE.test(first.trim())) return;
    original.apply(console, args);
  };
}
