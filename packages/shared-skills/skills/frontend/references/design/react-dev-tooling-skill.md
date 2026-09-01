# React Dev Tooling Defaults

When setting up or working on a React project, install three dev-only tools by default unless the user explicitly opts out. They make every coding agent's frontend work measurably faster and the resulting code measurably better.

## The three tools

| Tool | What it does | Why it's a default |
|---|---|---|
| **react-grab** | Cmd/Ctrl+C on any UI element copies its source location + nearby code + component stack into the clipboard, formatted for an AI agent to act on. | Cuts agent edit time **~2×** because the agent receives the actual source coordinates instead of guessing from a screenshot. From the author of Million.dev. |
| **react-scan** | Visually highlights every component render in dev. Detects unnecessary re-renders, slow renders, and tracks render causes. Has a headless `react-scan/lite` mode for automated perf measurement. | Catches re-render regressions the moment they happen, before they ship. Pairs with the perfection ruleset (`../perfection/README.md`) for Lighthouse 100 work. |
| **react-doctor** | Static scanner that finds bad React patterns across state & effects, perf, architecture, security, a11y. One-shot `npx react-doctor@latest` audit + CI GitHub Action + agent-skill installer. | Catches AI-generated React anti-patterns deterministically. Run before commit and in CI. Installs itself as a Claude Code / OpenCode / Cursor / Codex skill so the agent learns from each scan. |

All three are **dev-only** (`process.env.NODE_ENV === 'development'` or `import.meta.env.DEV`). None ship to production.

## Default install for a React project

Run from project root. This is the canonical setup. Skip ONLY if the user says "no extra dev tools" or the project README explicitly forbids them.

```bash
# 1. react-grab — adds itself to package.json + entry file with dev gate
npx grab@latest init

# 2. react-doctor — first audit + agent-skill install
npx react-doctor@latest install

# 3. react-scan — adds itself with dev gate
npx react-scan@latest init
```

The `init`/`install` CLIs handle framework detection and gating for you. If the CLI fails or the project uses a non-standard setup, fall back to the manual snippets below.

After install, confirm by reading the diff. Each tool should appear ONLY behind a `process.env.NODE_ENV === "development"` / `import.meta.env.DEV` gate.

## Manual install (when the CLI does not fit)

### Next.js (App Router) — `app/layout.tsx`

```tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV === "development" && (
          <>
            <Script
              src="//unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
            <Script
              src="//unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### Next.js (Pages Router) — `pages/_document.tsx`

Same pattern, but the `<Script>` tags live inside `<Head>` from `next/document` and gate on `process.env.NODE_ENV === 'development'`.

### Vite — `src/main.tsx` (or wherever the entry is)

```tsx
if (import.meta.env.DEV) {
  void import("react-grab");
  void import("react-scan");
}
```

Optionally add the Vite plugin for richer `displayName` data on react-scan:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import reactScan from "vite-plugin-react-scan";

export default defineConfig({
  plugins: [react(), reactScan()],
});
```

### Webpack / CRA — entry file top

```ts
if (process.env.NODE_ENV === "development") {
  void import("react-grab");
  void import("react-scan");
}
```

### Remix — `app/root.tsx`

```tsx
export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        {process.env.NODE_ENV === "development" && (
          <>
            <script crossOrigin="anonymous" src="//unpkg.com/react-grab/dist/index.global.js" />
            <script crossOrigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" />
          </>
        )}
        <Links />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
```

### Astro — `src/layouts/Layout.astro`

```astro
---
const isDev = import.meta.env.DEV;
---
<head>
  {isDev && (
    <>
      <script crossorigin="anonymous" src="//unpkg.com/react-grab/dist/index.global.js" is:inline></script>
      <script crossorigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" is:inline></script>
    </>
  )}
</head>
```

## react-doctor — wire the scan, not the bundle

react-doctor is a one-shot CLI plus a CI action, NOT a runtime injection. Wire it in three places:

1. **As an agent skill** so your coding agent learns from each scan and avoids the issues next time:

   ```bash
   npx react-doctor@latest install
   ```

   Detects Claude Code / OpenCode / Cursor / Codex automatically and writes the skill into the right location.

2. **As a local pre-commit / scripted gate:**

   ```bash
   # Manual audit
   npx react-doctor@latest

   # JSON for scripting / CI
   npx react-doctor@latest --json > .react-doctor-report.json
   ```

3. **As a CI gate** that blocks PRs when the static scan regresses:

   ```yaml
   # .github/workflows/react-doctor.yml
   name: React Doctor
   on: [pull_request]
   jobs:
     audit:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: millionco/react-doctor@main
   ```

## Feature flag — opt-out without surgery

The `NODE_ENV === "development"` gate already keeps these out of production. For temporarily disabling the runtime tools during a dev session (e.g. when profiling without instrumentation overhead), put one env var in front:

```ts
// entry file
const enableDevTools =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1";

if (enableDevTools) {
  void import("react-grab");
  void import("react-scan");
}
```

Then `NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS=1 npm run dev` skips both without re-editing code.

For Vite use `VITE_DISABLE_REACT_DEVTOOLS`, for CRA use `REACT_APP_DISABLE_REACT_DEVTOOLS`. The variable name MUST start with the framework's required prefix or it won't reach the bundle.

## When NOT to install these

- **The project is not React.** None of these apply to Solid, Svelte, Vue, Qwik, or any non-React framework. Skip silently.
- **The user explicitly said "no extra dev dependencies"** or the README forbids them. Respect that.
- **The project ships React 16 or earlier.** react-scan and react-doctor target modern React (17+, often 18+). Check `package.json` first; if the project is on legacy React, skip the runtime tools and only run react-doctor's static scan (it's framework-tolerant).
- **The project is a library, not an app.** Libraries have no entry file to inject into; only consumers (apps) should run the runtime tools. The static scan still applies.

## Verification

After install, sanity-check that the tools are loaded ONLY in dev:

```bash
# 1. Build for production
npm run build && npm run start  # or vite build && vite preview, etc.

# 2. Open the production URL and verify
#    - No react-grab toolbar visible
#    - No react-scan overlay or console output
#    - DOM contains zero <script> tags pointing at unpkg.com/react-grab or unpkg.com/react-scan
curl -s http://localhost:3000 | grep -E 'react-grab|react-scan' && echo "LEAK — fix the gate" || echo "OK"
```

If any of those leak into production, the dev gate is broken. Fix the gate before declaring done.

## Cross-skill references

- For **render performance / Lighthouse 100** work, see `../perfection/react-perf-tooling.md` — Playwright + `react-scan/lite` integration used during automated audits.
- For **debugging an in-flight React bug**, see `../../debugging/references/tools/react-devtools.md` — runtime/static use during a bug hunt rather than initial setup.
- The Phase 0 Design System Gate (in `README.md`) and this React Dev Tooling Gate are both pre-implementation gates. Run Phase 0 first (design system must exist), then this gate (dev tooling must be installed).

## Mantra

> **Every React project the agent sets up gets these three tools wired with dev-only gates by default. The user opts out, not in.**
