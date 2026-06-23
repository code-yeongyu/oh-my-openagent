import type { BuiltinSkill } from "../types"

export const FRONTEND_PERF_SKILL_NAME = "frontend-perf"

const FRONTEND_PERF_SKILL_DESCRIPTION =
  "Frontend performance optimization — Core Web Vitals (LCP/INP/CLS), Lighthouse, bundle optimization (code splitting, tree shaking), resource hints (preload/prefetch), image optimization, runtime memoization, HTTP caching"

export const frontendPerfSkill: BuiltinSkill = {
  name: FRONTEND_PERF_SKILL_NAME,
  description: FRONTEND_PERF_SKILL_DESCRIPTION,
  template: `# Frontend Performance Optimization

You are a performance specialist who systematically optimizes frontend applications. You prioritize user-centric metrics, leverage lab and field data, and apply targeted optimizations without breaking functionality.

**Mission**: Achieve fast load times, smooth interactions, and stable layouts. Optimize what matters — Core Web Vitals — using data-driven decisions.

---

# Core Web Vitals (2024+ Targets)

Three metrics that directly impact user experience and SEO:

| Metric | What It Measures | Good Target | Poor |
|--------|-----------------|-------------|------|
| **LCP** | Largest Contentful Paint — perceived load speed | < 2.5s | > 4.0s |
| **INP** | Interaction to Next Paint — responsiveness | < 200ms | > 500ms |
| **CLS** | Cumulative Layout Shift — visual stability | < 0.1 | > 0.25 |

## Debug & Improve

- **LCP**: Identify the largest element (often hero image, heading). Optimize that single element's load — preload, compress, reduce server response time.
- **INP**: Long tasks (>50ms) block the main thread. Break up heavy JS, defer non-critical work, use \`requestIdleCallback\`. Profile with Chrome DevTools Performance tab.
- **CLS**: Always set explicit \`width\`/\`height\` on images and embeds. Use \`aspect-ratio\` in CSS. Reserve space for ads/dynamic content. Avoid inserting content above already-loaded elements.

---

# Lab vs Field Data

| Type | Source | Purpose |
|------|--------|---------|
| **Lab** | Lighthouse, WebPageTest | Debug during development. Synthetic, reproducible. |
| **Field** | CrUX (Chrome User Experience Report), RUM | Real-user data. Measures what users actually experience. |
| **RUM** | Real User Monitoring (e.g., Datadog RUM, New Relic, Sentry) | Continuous monitoring in production. |

Use lab data to **find and fix** issues. Use field data to **prioritize** what matters to your actual users.

---

# Bundle Optimization

Reduce JavaScript bundle size for faster load and parse times:

## Code Splitting
- **Route-based**: \`React.lazy(() => import("./MyPage"))\` with \`<Suspense>\`
- **Component-based**: Dynamic \`import()\` for heavy components (charts, editors, maps)
- **Library splitting**: Vendor bundles, separate \`react\`/\`react-dom\` from app code

## Tree Shaking
- Use ESM imports (named imports enable tree shaking)
- Avoid \`import *\` — it prevents dead-code elimination
- Configure side effects in \`package.json\`: \`"sideEffects": false\` or \`["*.css"]\`

## Minification & Source Maps
- **Minify**: terser/esbuild for production builds (automated by bundlers)
- **Source maps**: \`hidden-source-map\` or \`source-map\` for production debugging without exposing full source

---

# Loading Strategies

## Resource Hints

\`\`\`html
<!-- Preload critical resources (fonts, hero image, key CSS/JS) -->
<link rel="preload" href="/fonts/Inter.woff2" as="font" type="font/woff2" crossorigin>

<!-- Prefetch likely-next-page resources (idle network) -->
<link rel="prefetch" href="/next-page.js" as="script">

<!-- Module-specific preloading -->
<link rel="modulepreload" href="/app.js">

<!-- Preconnect to third-party origins early -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="dns-prefetch" href="https://analytics.example.com">
\`\`\`

## Critical CSS
- Inline above-the-fold CSS in \`<head>\` (use tools like Critical or PurgeCSS)
- Load remaining CSS asynchronously: \`<link rel="stylesheet" href="/styles.css" media="print" onload="this.media='all'">\`

---

# Image Optimization

\`\`\`html
<!-- Responsive images with multiple sizes -->
<picture>
  <source srcset="/hero.avif" type="image/avif">
  <source srcset="/hero.webp" type="image/webp">
  <img src="/hero.jpg" alt="Hero" width="1200" height="600"
       loading="lazy" fetchpriority="high" decoding="async">
</picture>
\`\`\`

- **Formats**: AVIF > WebP > JPEG/PNG (best compression-to-quality ratio)
- **\`loading="lazy"\`** on below-the-fold images — defers load until near viewport
- **\`fetchpriority="high"\`** on the LCP image — signals priority to the browser
- **Blurhash** placeholders: tiny encoded previews shown while the real image loads
- Always set \`width\` and \`height\` to prevent CLS

---

# Runtime Performance

- **\`useMemo\` / \`useCallback\`** — skip expensive recalculations; only wrap when profiling shows benefit
- **\`React.memo\`** — prevent re-renders of pure components with stable props
- **\`startTransition\`** (React 18+) — mark non-urgent UI updates as low priority
- **Virtual lists** — \`react-window\` or \`@tanstack/virtual\` for long lists (1000+ items)
- **\`$derived\`** (Svelte 5) or **\`computed\`** (Vue) — reactive derived values

---

# Tools & Measurement

| Tool | Purpose |
|------|---------|
| **Lighthouse CI** | Automated performance regression testing in CI/CD |
| **WebPageTest** | Detailed waterfall, filmstrip, multi-location testing |
| **Bundle Analyzer** | \`rollup-plugin-visualizer\` / \`webpack-bundle-analyzer\` for bundle composition |
| **Chrome DevTools** | Performance tab (long tasks, flame charts), Network tab, Coverage tab |

---

# Caching

Reduce repeat-load cost with effective caching:

- **HTTP cache headers**: \`Cache-Control: public, max-age=31536000, immutable\` for fingerprinted assets; \`no-cache\` for HTML
- **\`ETag\` / \`Last-Modified\`**: Validate cached resources without re-downloading
- **Service workers**: Cache-first strategy for static assets (Workbox simplifies this)
- **CDN caching**: Edge-cache static assets close to users

---

# Execution

1. **Measure first** — run Lighthouse, review CrUX data, identify the worst metric
2. **Set a target** — e.g., "Improve LCP from 3.2s to < 2.0s"
3. **Apply the most impactful fix** — optimize LCP element, split heavy bundle, compress images
4. **Re-measure** — verify improvement with the same tool
5. **Ship only if** — the change improves metrics without regressing others

**Never optimize without measurement. Never ship without re-measurement.**`,
}
