# React Perf Tooling for Lighthouse 100

You are auditing or optimizing a React app for Lighthouse 100. Two tools belong in this workflow alongside Playwright + lighthouse — they catch the React-specific perf issues that Lighthouse counts but doesn't diagnose by component:

| Tool | Surface | What it gives you |
|---|---|---|
| **react-scan** (`react-scan/lite`) | Runtime instrumentation, headless | Per-fiber `commit` events with `changeDescription` — "this component re-rendered because <prop / state / context / parent / hook> changed". Correlates with `long-animation-frame` to attribute LoAF to specific components. |
| **react-doctor** | Static scan, CI-friendly | Deterministic findings across state/effects, perf (memoization, list keys, expensive children), architecture, security, a11y. One-shot `npx react-doctor@latest` produces a JSON report. From the Million.dev team. |

Use both. They are complementary: `react-scan` tells you *what's slow right now*; `react-doctor` tells you *what's structurally wrong*. Both are dev-only and free.

If the project does not yet have react-scan and react-doctor wired into its dev environment, read `../design/react-dev-tooling-skill.md` first and install them — they should be on by default for every React project this skill audits.

## Lighthouse run + react-scan/lite

`playwright-lighthouse` already drives a real Chrome. Inject `react-scan/lite` BEFORE React mounts via `page.addInitScript`. Then drain its `onEvent` stream during the run and assert on render budgets at the end.

```ts
// scripts/audit-with-react-scan.ts
import { chromium } from "playwright";
import { playAudit } from "playwright-lighthouse";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext();

// Inject react-scan/lite BEFORE the app boots
await context.addInitScript(() => {
  // @ts-ignore — pulled from the project's node_modules or a self-hosted bundle
  import("react-scan/lite").then(({ instrument }) => {
    (window as any).__renderEvents = [];
    instrument({
      onEvent: (event: any) => {
        if (event.kind === "commit") (window as any).__renderEvents.push(event);
      },
      recordChangeDescriptions: true,
      includeFiberSource: true,
      includeFiberIdentity: true,
    });
  });
});

const page = await context.newPage();
await page.goto("http://localhost:3000/<route>");

await playAudit({
  page,
  port: 9222,
  thresholds: { performance: 100, accessibility: 100, "best-practices": 100, seo: 100 },
  reports: { formats: { html: true, json: true }, name: "lighthouse-<route>" },
  config: { extends: "lighthouse:default", settings: { formFactor: "mobile" } },
});

// Pull render events and assert on render quality
const events = await page.evaluate(() => (window as any).__renderEvents);
const unnecessary = events.filter((e: any) =>
  e.tree?.some((node: any) => node.changeDescription?.kind === "unnecessary"),
);

if (unnecessary.length > 0) {
  console.error(`FAIL: ${unnecessary.length} unnecessary renders detected during audit`);
  for (const e of unnecessary.slice(0, 10)) console.error("  -", JSON.stringify(e, null, 2));
  process.exit(1);
}

await browser.close();
```

This is the canonical integration. Run twice per route (mobile + desktop), same as the base Lighthouse workflow. Both must hit 100/100/100/100 AND zero unnecessary renders.

## react-doctor — static perf gate

Before the Playwright run, fail fast on structural issues. The scan is fast and doesn't need a browser, so put it earlier in the pipeline.

```bash
npx react-doctor@latest --json > .react-doctor-report.json
```

Parse `.react-doctor-report.json` for perf-category findings. Treat any perf finding as a blocker for the same reason you treat a Lighthouse score < 100 as a blocker — these are deterministic issues that *will* show up in Lighthouse eventually under throttling.

Wire it into CI as a separate job (cheap, fast, no browser needed):

```yaml
- name: React Doctor static perf scan
  uses: millionco/react-doctor@main
```

Or run inline with a fail filter:

```yaml
- name: React Doctor static perf scan
  run: npx react-doctor@latest --json --fail-on perf
```

## When to load which during an audit

Run them in this order, stop at the first failure:

1. **`react-doctor`** — cheapest. Catches missing memoization, broken list keys, unstable callback refs, expensive children that re-render unnecessarily. Fix everything it reports BEFORE running Lighthouse — half the perf score wins live here.
2. **`react-scan` interactive in dev** — load the page in real Chrome with `npx react-scan@latest init` already wired (see the dev-tooling reference). Walk the LCP route, the most-clicked CTA, and any animation-heavy view. The toolbar shows render counts; the overlay highlights unnecessary renders in gray. Fix until clean.
3. **`react-scan/lite` in the Lighthouse run** — once interactive is clean, run the Playwright audit above. This catches anything that only shows under throttling or only on first paint.
4. **Playwright + Lighthouse** — standard run from `README.md` audit workflow. Score 100 + zero unnecessary renders from step 3 = done.

## React-specific perf root causes (extends `README.md` ROOT-CAUSE CHECKLIST)

These are the failures `react-scan` and `react-doctor` surface that base Lighthouse won't directly name:

- **Context value identity churn.** A provider value `useMemo` was forgotten; every consumer re-renders on every render of the provider's parent. → `useMemo` the value, or split contexts so high-churn fields don't sit next to stable ones.
- **Inline object/array/callback props on memoized children.** `<Child config={{ a: 1 }} />` breaks `React.memo` every render. → Hoist, `useMemo`, or `useCallback`.
- **List keys = array index.** Reordering shreds the reconciler. → Use a stable id from the data.
- **Expensive components rendered unconditionally above the fold.** → `lazy()` + `Suspense`, or move below the LCP, or pre-render server-side.
- **Effects that fire on every render.** Missing dependency arrays or unstable deps. → Stabilize deps, or split state, or extract to `useEvent`-style ref.
- **Spreading the entire context value into props.** Couples every consumer to every field. → Destructure only the fields used.
- **Hydration mismatches.** SSR markup doesn't equal client first-render. → react-doctor flags structurally; fix the source of the divergence (Date.now, locale, randomness, browser-only APIs).

`react-doctor` finds these statically. `react-scan` confirms the symptom in the running app. Both must come clean before Lighthouse 100 is meaningful.

## Anti-patterns specific to this workflow

- **Forgetting `page.addInitScript` (using `page.evaluate` instead).** `evaluate` runs AFTER React mounts; you'll miss every initial-render event. Use `addInitScript`.
- **`react-scan` non-lite during a Lighthouse run.** The full UI (toolbar, canvas overlay) adds overhead and skews the score. Use `react-scan/lite` ONLY for measurement; the full version is for interactive dev.
- **Reporting Lighthouse 100 with `react-scan` showing 30+ unnecessary renders per route.** The score is meaningless if the React layer is thrashing — INP and CLS will degrade under real load even if the synthetic run passed. Both gates must clear.
- **Treating `trackUnnecessaryRenders` as free.** It has measurable overhead; in a Lighthouse run it can drag the perf score by 2-3 points. Use it for interactive diagnosis, not for the audit run.
- **Skipping react-doctor because "it's just a linter".** It's not. It detects React-specific defects (missing keys, broken memo, unstable refs, hydration mismatches) that ESLint plugins miss because they require fiber-level reasoning.

## Mantra

> **Lighthouse 100 + react-doctor clean + zero unnecessary renders from react-scan. All three or it is not done.**
