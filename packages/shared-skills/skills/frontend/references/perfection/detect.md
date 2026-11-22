# frontend-detect: the after-build lint

`scripts/detect/` is a typed TypeScript SDK that renders a page and lints what the browser actually drew: contrast against the painted background, the type scale in use, spacing, overflow, decoration tells, and copy tells. The rule logic is ported from the detector of [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0, Copyright 2025 Paul Bakaus) plus one reflow check from [changeroa/StyleGallery](https://github.com/changeroa/StyleGallery) (MIT); see `ATTRIBUTION.md` section 7.

It runs after the draft builds and before `/visual-qa`. `check-draft-guard.ts` stays the first lint on source; this one needs a rendered page and catches what source cannot show: a 4.2:1 table header in dark mode, an h1 followed by an h3, a heading that wraps one word onto its last line, a card that overflows at 390.

## Run it

From code (the primary interface). Import `index.ts`; importing does nothing until you call a function:

```ts
const detect = await import(`${SKILL_DIR}/scripts/detect/index.ts`)
const findings = await detect.detectPage({ kind: "url", url: "http://localhost:5173/settings" }, {
  viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }],
  reflow: true,
  config: { allowFonts: ["Inter"], designTokens: { radii: [8, 12] } },
})
if (detect.hasFailures(findings)) console.log(detect.formatFindingsText(findings))
```

- `detectPage(target, options)`: `target` is `{ kind: "url", url }` or `{ kind: "html", html }`. Renders at each viewport (default 1440 and 390) and returns sorted, de-duplicated findings.
- `detectFiles(paths, options)`: HTML files are rendered; CSS/SCSS/Less, JSX/TSX, Vue, Svelte and Astro files run the source-text rules.
- `lintSnapshot(snapshot, options)` / `lintSources(files, options)`: the pure rule engines, for a snapshot you captured yourself with `collectPageSnapshot` in your own Playwright or omowright page.
- `renderer`: pass your own `Renderer` to reuse a browser you already drive; the default is `Bun.WebView` (system WebKit on macOS, installed Chrome elsewhere; `createWebViewRenderer({ backend: "chrome" })` matches the upstream engine most closely).
- Every finding carries `ruleId`, `severity` (`error`, `warning`, `advisory`), `category`, `message`, `fixHint`, and a `location`: an element (`selector`, `rect`, `viewport`), a source position (`file`, `line`, `column`), or the page.

From a shell, the CLI is a thin wrapper over the same calls:

```bash
bun $SKILL_DIR/scripts/detect/cli.ts [--json] [--reflow] [--config detect.json] <file-or-dir-or-url>...
```

Exit 0: no error or warning findings. Exit 1: at least one. Exit 2: usage error or a page that failed to render.

## Config

`--config` (or `options.config`) takes JSON:

| Key | Meaning |
|---|---|
| `rules` | `{ "<rule-id>": "error" \| "warning" \| "advisory" \| "off" }` per rule |
| `allowFonts` | Families the project chose on purpose (Inter on a product that matches its platform); never reported as overused |
| `allowEasings` | Timing functions `DESIGN.md` names on purpose, such as an intentional spring |
| `designTokens` | `{ fonts, colors, radii, fontSizes }`; the `design-system-*` rules report values outside them and stay silent without them |

Waive one element with `data-detect-ignore="<rule-id> <rule-id>"` on it or an ancestor (upstream's `data-impeccable-ignore` is honoured too). A waiver needs the reason in `DESIGN.md`.

## Reading the result

- `error` and `warning` fail the gate: fix them before `/visual-qa`. `low-contrast` is an error here, stricter than upstream, because a contrast failure is never a taste call.
- `advisory` findings are review prompts (`hard-offset-shadow` on a page that chose neobrutalism, `bounce-easing` on a named spring). Record the decision; do not delete a deliberate choice to silence one.
- A finding you believe is wrong: rerun at the viewport it names and read the computed values it quotes. Waive it with the attribute only when `DESIGN.md` explains why.
