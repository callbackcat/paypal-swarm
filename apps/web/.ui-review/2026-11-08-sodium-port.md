# UI review: Sodium port of the Swarm web app

All five screens render on Sodium components and tokens only, and after the fixes below none of them scrolls sideways at 390 or hides a control.

Ready to ship: yes. All blocking and should-fix findings from the first pass were fixed in this session and re-captured (blocking 0 open, should-fix 0 open, notes 4, 3 questions for a person).

## Review record

- Source: `apps/web` at the working tree of 8 Nov 2026 (uncommitted Sodium port), dev server `next dev -p 3002` with `NEXT_DIST_DIR=.next-review`, api on `localhost:8787` (mock PayPal, scripted agents).
- Tool: headless Chrome 1280 and 390 wide through the DevTools pipe (`scratchpad/cdp/cdp.mjs`), `Emulation.setDeviceMetricsOverride` for width, `Page.captureScreenshot` for the captures in `2026-11-08-sodium-port/`. The Claude in Chrome extension was not connected when the review started; the user opened Chrome later, which was not needed after that.
- Widths: 390 and 1280. Theme: dark (`data-theme="dark"`, the only theme the app ships).
- Criteria: `.claude/skills/ui-review/references/criteria.md` plus the Sodium rules in `.claude/skills/sodium/SKILL.md` and `sodium.eslint.config.mjs`.
- Lint: `pnpm exec eslint -c sodium.eslint.config.mjs .` in `apps/web`, exit 0 after fixes (one error before: inline style on the AG Studio mount). `npx tsc --noEmit`, exit 0. `next build`, 0 errors 0 warnings. `pnpm test`, 43 tests pass.
- Purpose per screen (assumed from the product spec, not given by the caller):
  - Setup `/`: pick a scenario and merchant profile, see the estimate, release a run.
  - Runs `/runs`: find an earlier run and open its arena or report.
  - Arena `/runs/:id`: watch a run live, decide approvals, pause or stop, then open the report.
  - Report `/runs/:id/report`: read the readiness score and findings, re-run against the other profile, export.
  - Studio `/runs/:id/studio`: ask the AG Studio analyst for widgets over the run data.
- Assumptions and gaps: data came from five finished scripted runs, so the running, paused, approval-pending and budget-exhausted states of Arena were not captured. Timing was measured on the dev build, which is slower than production. No panel of reviewers; one reviewer sorted alone.

## Probes

| Probe | Result |
|---|---|
| Keyboard path, 14 Tab presses, Setup 1280 | brand, 3 nav links, 2 radios, 3 inputs, 2 selects, switch, Allow-lists trigger, Release the swarm. Every stop reports a visible ring (outline or box shadow on the element or within 3 ancestors). |
| Keyboard path, Arena 1280 | nav, Studio, Report, Re-run hardened, Open report, segmented filter, Wrap lines, Copy lines, filter input, level chips, log region. Ring on every stop. |
| Keyboard path, Report 1280 | nav, Arena, Studio, two downloads, Re-run with fix, four finding triggers. Ring on every stop. |
| Focus after close | Not run: no dialog or menu on these screens. |
| Loading state | Setup and Runs captured under 3 s network latency (`setup-loading-1280.png`, `runs-loading-1280.png`). |
| Error state | Setup, Runs, Arena, Report captured with every api request blocked (`*-error-1280.png`). |
| Throttled CPU, 4x | Event Timing on the Setup Allow-lists toggle: 368 to 408 ms per press (dev build). Arena Wrap lines: 216 to 320 ms. Report finding trigger: 48 to 96 ms. |
| Press feedback, no throttle | Setup Allow-lists 40 to 48 ms, Arena Wrap lines 16 to 32 ms, Report finding trigger 24 ms. All under 100 ms. |
| Reduced motion | `prefers-reduced-motion: reduce` emulated: `document.getAnimations().length` is 0 on Setup, Arena and Report (finished run, so no live mark was running). |
| Touch width | 390 captured for all five screens; `document.documentElement.scrollWidth` equals 390 on each after fixes. |
| Console | One 404 per page (Next dev asset, see For a person). Studio: 15 console errors, all the AG Studio trial-licence banner. |
| Accessibility scan | `lang="en"`, one `h1` per page, every visible input, select and switch carries a label through Base UI's generated ids. No unnamed visible control. |

## Findings

### Fixed in this session (were blocking or should-fix)

1. **Page scrolled sideways at 390** (criterion 12, raised by reviewer). Setup laid out 445 px wide, Arena 658 px, because the page grids had no base column and the implicit `auto` track grew to the table's width. Evidence: first-pass probe `scrollWidth` 445 and 658 at `innerWidth` 390. Fix: `grid-cols-1` on the three page grids. Check: `scrollWidth === 390` on `/`, `/runs/:id`, `/runs/:id/report`; now true for all five routes.
2. **Recent runs table clipped its Score column at 1280** (criterion 12, `setup-1280.png` first pass: header read `SCOR`). Long run names did not wrap in the 390 px aside. Fix: the name cell wraps (`whitespace-normal wrap-anywhere`). Check: Score values visible in `setup-1280.png`.
3. **Status strip units overflowed** (criterion 11, Arena and Report 1280: "0 rate limits, not sc", "3 captured without"). Fix: one short unit per cell, Approvals dropped from the Arena strip (it has its own frame with a pending count), GMV moved to the Cost list. Check: no clipped unit in `arena-1280.png` or `report-1280.png`.
4. **Error text was the browser's "Failed to fetch"** (criterion 8, all `*-error-1280.png` first pass). Fix: `describeError` names the api URL and says to start it or set `NEXT_PUBLIC_API_URL`. Check: `setup-error-1280.png` shows the sentence.
5. **Setup said "loading" and "No runs yet" while the api was down** (criterion 7). Fix: the Scenario frame says "unavailable" with a sentence, Recent runs shows a loading table until the list arrives and an error empty state on failure. Checks: `setup-loading-1280.png`, `setup-error-1280.png`.
6. **Runs showed skeleton rows beside the error** (criterion 7, `runs-error-1280.png` first pass). Fix: error empty state with `reason="error"`.
7. **Arena rendered a fake live run when the api was down** (criterion 7, first pass showed "Shoppers are browsing", "Streaming", disabled Pause and Stop, "unknown merchant"). Fix: title, id and the error alert only. Check: `arena-error-1280.png`.
8. **Report dimension marks sat on their own line** (criterion 10, `report-1280.png` first pass). Fix: mark and value in one inline flex. Check: `report-1280.png`.
9. **Finding titles rendered as mono capitals** (Sodium: sentences in sans; `report-1280.png` first pass). Fix: title span in `type-body-sm normal-case`. Also "1 events" pluralised.
10. **Alert title was the run name in capitals** (criterion 5). Fix: "Run finished", "Run stopped at the token cap", "Run failed", "Run stopped".
11. **Insight title truncated at 390** (criterion 11, `arena-390.png` first pass: "3 paid orders without trac..."). Fix: row wraps.
12. **Body kept the browser's 8 px margin** (criterion 10, header started at x=8 in the probe). Fix: `html, body { margin: 0 }`.
13. **Inline style on the AG Studio mount** (Sodium lint `no-inline-style`). Fix: sized through `.ag-studio-host > *` in `globals.css`.

### Notes (open)

- **Tables scroll inside their frame at 390** (criterion 12, `runs-390.png`, `arena-390.png` Webhooks). Runs is 1251 px wide inside a 390 px frame with no visible scroll hint beyond the clipped last column. Sodium's Table scrolls sideways by design; a sticky first column or a 390 layout that drops Tokens and Cost would help a phone user. Not blocking: every column is reachable by scrolling the frame.
- **Studio is a desktop tool** (criterion 12, `studio-390.png`). AG Studio lays out 625 px wide inside the frame at 390 and 15,564 px at 1280 inside its own scroll container. The page header, links and meta line fit. A phone note above the embed ("Studio works best on a wide screen") would set expectations.
- **Primary action sits below the fold at 390** (criterion 2, `setup-390.png`). "Release the swarm" follows the whole form in the aside. On a phone the user scrolls once; the estimate it sits in should stay with the button, so moving it up would split the estimate. Left as is.
- **Dev-build press timing under 4x CPU throttle exceeds 100 ms on Setup and Arena** (criterion 13, measured 216 to 408 ms). The unthrottled numbers pass. Measure again on the production build before judging; the Allow-lists toggle re-renders the whole Setup form, which is the likely cost.

## Edge cases

| Case | Shown |
|---|---|
| Empty | Shown: Orders, Webhooks, Recent runs, Runs (text, action in Runs). Findings empty shown by code path, not captured (every run had findings). |
| Loading, slow loading | Shown: Runs skeleton, Setup loading table and "loading" value. Arena and Report loading not captured. |
| Error, failed save | Shown: api down on Setup, Runs, Arena, Report. A failed approval decision or pause (POST error) not captured; it lands in the same alert. |
| Partial data | Shown: Arena with 0 orders but 6 webhooks and 69 events. |
| Long and very short content | Shown: run name `smoke 2026-11-04T20:10:32.951Z` wraps in the aside, order ids in the findings. Very short not shown. |
| Narrowest and widest, switch point | 390 and 1280 shown. The 1024 to 1280 switch (xl grid on Arena) not captured. |
| First use, returning user with lots of data | First use shown (empty states). Lots of data not shown (5 runs). |
| No permission, read-only | Not shown; the app has no roles. |
| Offline | Shown as "api down" (requests blocked). |
| Success after the main action | Not shown; releasing a run navigates to the Arena, which was not captured in its running state. |
| Stand-in content | Real run data, no placeholder text. |
| Touch: hover, input zoom, keyboard | Inputs are 30 px tall with 14 px text, so iOS will not zoom; not verified on a device. No hover-only control. |
| Motion: reduced, repeated quickly, throttled CPU | Reduced motion shown (0 animations). Repeated presses measured 3 per probe. Throttled shown. |

## For a person to decide

1. The request for `/_next/...` that returns 404 on every page in dev (likely the dev overlay's source map or a font fallback at `/fonts/sodium/`). Confirm on the production build and hand to QA if it persists.
2. AG Studio prints its trial-licence banner as console errors on the Studio page. Set `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` once the trial key arrives, or accept the watermark for the demo.
3. The Setup estimate shows "None" for shoppers, tokens and cost while scenarios load. A skeleton would read as loading; "None" reads as a value. Product call, since the api answers within a second locally.

## Dismissed and left out

- Yellow meter bars on the Report dimensions (reviewer): Sodium's Meter default fill with thresholds off; a token choice, not a finding.
- Alert title in capitals (reviewer): Sodium's AlertTitle is a label role by design; the fix was shorter label text, not a different role.
- Radio marks are 16 px (reviewer, criterion 13 target size): the whole option label is the hit area (full row, 40 px and more). Dismissed.
- The 1 x 1 hidden inputs inside Base UI radios flagged by the scan: hidden by design, dismissed.

Coverage: routes `/`, `/runs`, `/runs/:id`, `/runs/:id/report`, `/runs/:id/studio`; widths 390 and 1280; theme dark; probes keyboard path, loading, error, throttled CPU, reduced motion, press timing, horizontal overflow, console, accessibility names. Not measured: running and paused Arena states, approval-pending state, the 1024 switch point, light theme (not shipped), real device touch, production-build timing.
