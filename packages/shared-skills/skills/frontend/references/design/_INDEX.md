# Frontend Design References — Index

All reference files live flat in this directory. Three layers:
- **Layer 0 — design system architecture** (1 file): the mandatory gate. Defines `DESIGN.md` structure, creation workflow, validation rules. Always loaded by Phase 0 when no design system exists.
- **Layer A — taste skills** (12 files): how to execute. Discipline, motion, spacing, anti-slop, output completeness.
- **Layer B — design systems** (70 files): what it should look like. Brand-specific color/type/component tokens.

**Phase 0 runs first** (check/create `DESIGN.md`), then most non-trivial tasks load **one Layer A + one Layer B** together. See the routing flow in the sibling `README.md`.

---

## Layer 0 — Design System Architecture (1)

| File | Purpose | Load when |
|---|---|---|
| `design-system-architecture.md` | Defines the 7-section `DESIGN.md` structure (atmosphere, color tokens, typography scale, spacing system, components, motion, depth). Creation workflow for new and existing projects. Validation rules and memory management. | Phase 0 fires and no `DESIGN.md` exists in the project. Also load when extracting a design system from existing code. |

---

## Layer A — Taste Skills (12)

From [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill).

### Code-generation skills (write actual frontend code)

| File | Purpose | Load when |
|---|---|---|
| `taste-skill.md` | Default all-rounder. Premium frontend without forcing one narrow visual style. Has 3 dials: DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY. | The user wants a "good-looking" website/app and gives no specific aesthetic direction. Safe default. |
| `gpt-tasteskill.md` | Stricter, more opinionated. High-variance layouts, stronger GSAP motion, more aggressive anti-slop. Tuned for GPT/Codex. | The user wants something genuinely *Awwwards-tier* — bold layouts, magnetic interactions, scroll-triggered scenes. Or `taste-skill.md` results felt "too safe". |
| `image-to-code-skill.md` | Image-first workflow: generate premium reference images → analyze → implement to match. | The user says "generate the design first, then code it", or visual quality is the main challenge. Pair with `imagegen-frontend-web.md`. |
| `redesign-skill.md` | Audits existing UI and surgically fixes weak layout, spacing, hierarchy, color, type. Does NOT rewrite from scratch. | Existing project + "make this better", "improve the UI", "redesign", "this looks bad". DO NOT use on greenfield. |
| `soft-skill.md` | Polished, calm, expensive-looking. Softer contrast, generous whitespace, premium fonts (Geist, Inter Display), spring motion. | The user says "premium", "luxurious", "calm", "expensive", "spa", "wellness", "boutique", "editorial". Or shows references like Linear, Vercel, Stripe, Apple marketing. |
| `minimalist-skill.md` | Editorial product UI inspired by Notion/Linear. Restrained monochrome palette, crisp structure, generous whitespace. | The user says "minimal", "clean", "Notion-style", "Linear-style", "editorial", "boring is good", "remove decoration". |
| `brutalist-skill.md` | BETA. Mechanical visual language. Swiss typography, sharp contrast, raw structure, experimental composition. | The user says "brutalist", "raw", "Swiss", "experimental", "industrial", "unstyled", "anti-design". |
| `output-skill.md` | Pushes for complete output: no placeholder comments, no `// TODO`, no skipped implementation, no half-done components. | Stack on top of any other skill when the agent has been lazy or the user complains "you keep leaving things undone". Do not use alone. |
| `stitch-skill.md` | Google Stitch-compatible semantic design rules. Includes the extra DESIGN.md export format. | The user is working with Google Stitch, or explicitly wants Stitch-format output, or wants a DESIGN.md alongside the code. |

### Image-generation skills (do NOT write code, only produce reference imagery)

| File | Purpose | Load when |
|---|---|---|
| `imagegen-frontend-web.md` | Generates Awwwards-level website design reference *images*. Strong typography, generous spacing, anti-slop visual discipline. | "Generate a mockup", "design reference image", "show me what it could look like", before any code. Pair with `image-to-code-skill.md` for the full image-to-code flow. |
| `imagegen-frontend-mobile.md` | Generates premium mobile app screen concepts and flows. iOS, Android, cross-platform. Phone mockup framing, multi-screen consistency. | Mobile app screen mockups, app flow images, iOS/Android UI references — image only, no code. |
| `imagegen-brandkit.md` | Generates premium brand-kit overview images: logo concepts, color systems, typography specimens, mockups, identity boards. | Brand identity moodboard, logo direction, full brand-kit board. Image only. |

### Layer A stacking rules

1. **At most one *style* skill at a time** (`taste-skill`, `gpt-tasteskill`, `minimalist-skill`, `brutalist-skill`, `soft-skill`, `redesign-skill`, `image-to-code-skill`). They encode opposite philosophies — picking two creates contradictions.
2. **`output-skill.md` and `stitch-skill.md` stack on top of any style skill.** They add discipline and output format, not visual direction.
3. **`image-to-code-skill.md` pairs with one imagegen skill** for the full flow.
4. **Imagegen skills are image-only.** Do not load them when the user actually wants code.

---

## Layer B — Design Systems (70)

Most Layer B files are materialized from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md), based on [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/overview/). Project-original entries such as `aside.md` are listed here only when `ATTRIBUTION.md` and `frontend-refs-manifest.mjs` mark them as original. Each file captures one website's complete visual language: color palette, typography, components, layout principles, depth, do/don't, responsive behavior, and an agent prompt guide.

### How to use

When the user says **"make it look like [Brand]"**, **"[Brand]-style"**, **"like [Brand]'s site"**, or shows that brand's site as a reference, load the corresponding `<brand>.md` file and treat it as the project's design system. Combine with one Layer A taste-skill for execution discipline.

Each file ships with: visual theme, hex color palette + semantic roles, full type hierarchy, button/card/input/nav specs with hover/active states, spacing scale, shadow system, do/don't list, breakpoints, and a ready-to-use agent prompt.

### AI & LLM Platforms (12)

| File | Aesthetic |
|---|---|
| `claude.md` | Anthropic's AI assistant. Warm terracotta accent, parchment canvas, literary salon mood, clean editorial layout. |
| `cohere.md` | Enterprise AI platform. Vibrant gradients, data-rich dashboard aesthetic. |
| `elevenlabs.md` | AI voice platform. Dark cinematic UI, audio-waveform aesthetics. |
| `minimax.md` | AI model provider. Bold dark interface with neon accents. |
| `mistral.ai.md` | Open-weight LLM provider. French-engineered minimalism, purple-toned. |
| `ollama.md` | Run LLMs locally. Terminal-first, monochrome simplicity. |
| `opencode.ai.md` | AI coding platform. Developer-centric dark theme. |
| `replicate.md` | Run ML models via API. Clean white canvas, code-forward. |
| `runwayml.md` | AI video generation. Cinematic dark UI, media-rich layout. |
| `together.ai.md` | Open-source AI infrastructure. Technical, blueprint-style design. |
| `voltagent.md` | AI agent framework. Void-black canvas, emerald accent, terminal-native. |
| `x.ai.md` | Elon Musk's AI lab. Stark monochrome, futuristic minimalism. |

### Developer Tools & IDEs (8)

| File | Aesthetic |
|---|---|
| `aside.md` | AI browser agent. Bright product-app marketing, custom display type, soft squircle controls, browser-product framing. |
| `cursor.md` | AI-first code editor. Sleek dark interface, gradient accents. |
| `expo.md` | React Native platform. Dark theme, tight letter-spacing, code-centric. |
| `lovable.md` | AI full-stack builder. Playful gradients, friendly dev aesthetic. |
| `raycast.md` | Productivity launcher. Sleek dark chrome, vibrant gradient accents. |
| `superhuman.md` | Fast email client. Premium dark UI, keyboard-first, purple glow. |
| `vercel.md` | Frontend deployment platform. Black and white precision, Geist font. |
| `warp.md` | Modern terminal. Dark IDE-like interface, block-based command UI. |

### Backend, Database & DevOps (9)

| File | Aesthetic |
|---|---|
| `clickhouse.md` | Fast analytics database. Yellow-accented, technical documentation style. |
| `composio.md` | Tool integration platform. Modern dark with colorful integration icons. |
| `hashicorp.md` | Infrastructure automation. Enterprise-clean, black and white. |
| `mongodb.md` | Document database. Green leaf branding, developer documentation focus. |
| `posthog.md` | Product analytics. Playful hedgehog branding, developer-friendly dark UI. |
| `sanity.md` | Headless CMS. Red accent, content-first editorial layout. |
| `sentry.md` | Error monitoring. Dark dashboard, data-dense, pink-purple accent. |
| `supabase.md` | Open-source Firebase alternative. Dark emerald theme, code-first. |

### Productivity & SaaS (7)

| File | Aesthetic |
|---|---|
| `cal.md` | Open-source scheduling. Clean neutral UI, developer-oriented simplicity. |
| `intercom.md` | Customer messaging. Friendly blue palette, conversational UI patterns. |
| `linear.app.md` | Project management for engineers. Ultra-minimal, precise, purple accent. |
| `mintlify.md` | Documentation platform. Clean, green-accented, reading-optimized. |
| `notion.md` | All-in-one workspace. Warm minimalism, serif headings, soft surfaces. |
| `resend.md` | Email API for developers. Minimal dark theme, monospace accents. |
| `zapier.md` | Automation platform. Warm orange, friendly illustration-driven. |

### Design & Creative Tools (6)

| File | Aesthetic |
|---|---|
| `airtable.md` | Spreadsheet-database hybrid. Colorful, friendly, structured data aesthetic. |
| `clay.md` | Creative agency. Organic shapes, soft gradients, art-directed layout. |
| `figma.md` | Collaborative design tool. Vibrant multi-color, playful yet professional. |
| `framer.md` | Website builder. Bold black and blue, motion-first, design-forward. |
| `miro.md` | Visual collaboration. Bright yellow accent, infinite canvas aesthetic. |
| `webflow.md` | Visual web builder. Blue-accented, polished marketing site aesthetic. |

### Fintech & Crypto (7)

| File | Aesthetic |
|---|---|
| `binance.md` | Crypto exchange. Bold Binance Yellow on monochrome, trading-floor urgency. |
| `coinbase.md` | Crypto exchange. Clean blue identity, trust-focused, institutional feel. |
| `kraken.md` | Crypto trading platform. Purple-accented dark UI, data-dense dashboards. |
| `mastercard.md` | Global payments network. Warm cream canvas, orbital pill shapes, editorial warmth. |
| `revolut.md` | Digital banking. Sleek dark interface, gradient cards, fintech precision. |
| `stripe.md` | Payment infrastructure. Signature purple gradients, weight-300 elegance. |
| `wise.md` | International money transfer. Bright green accent, friendly and clear. |

### E-commerce & Retail (5)

| File | Aesthetic |
|---|---|
| `airbnb.md` | Travel marketplace. Warm coral accent, photography-driven, rounded UI. |
| `meta.md` | Tech retail store. Photography-first, binary light/dark surfaces, Meta Blue CTAs. |
| `nike.md` | Athletic retail. Monochrome UI, massive uppercase Futura, full-bleed photography. |
| `shopify.md` | E-commerce platform. Dark-first cinematic, neon green accent, ultra-light display type. |
| `starbucks.md` | Coffee retail flagship. Four-tier earth-green system, warm cream canvas, SoDoSans typography. |

### Media & Consumer Tech (11)

| File | Aesthetic |
|---|---|
| `apple.md` | Consumer electronics. Premium white space, SF Pro, cinematic imagery. |
| `ibm.md` | Enterprise technology. Carbon design system, structured blue palette. |
| `nvidia.md` | GPU computing. Green-black energy, technical power aesthetic. |
| `pinterest.md` | Visual discovery platform. Red accent, masonry grid, image-first. |
| `playstation.md` | Gaming console retail. Three-surface channel layout, cyan hover-scale interaction. |
| `spacex.md` | Space technology. Stark black and white, full-bleed imagery, futuristic. |
| `spotify.md` | Music streaming. Vibrant green on dark, bold type, album-art-driven. |
| `theverge.md` | Tech editorial media. Acid-mint and ultraviolet accents, Manuka display type. |
| `uber.md` | Mobility platform. Bold black and white, tight type, urban energy. |
| `vodafone.md` | Global telecom brand. Monumental uppercase display, Vodafone Red chapter bands. |
| `wired.md` | Tech magazine. Paper-white broadsheet density, custom serif, ink-blue links. |

### Automotive (6)

| File | Aesthetic |
|---|---|
| `bmw.md` | Luxury automotive. Dark premium surfaces, precise German engineering aesthetic. |
| `bugatti.md` | Luxury hypercar. Cinema-black canvas, monochrome austerity, monumental display type. |
| `ferrari.md` | Luxury automotive. Chiaroscuro black-white editorial, Ferrari Red with extreme sparseness. |
| `lamborghini.md` | Luxury automotive. True black cathedral, gold accent, LamboType custom Neo-Grotesk. |
| `renault.md` | French automotive. Vivid aurora gradients, NouvelR proprietary typeface, zero-radius buttons. |
| `tesla.md` | Electric vehicles. Radical subtraction, cinematic full-viewport photography, Universal Sans. |

### Mood-based shortcuts (when user describes feeling, not naming a brand)

- **"Premium / luxurious / expensive"** → `apple.md`, `stripe.md`, `vercel.md`, `linear.app.md`
- **"Editorial / paper-like / readable"** → `notion.md`, `wired.md`, `claude.md`
- **"Brutal / Swiss / industrial"** → `nike.md`, `bugatti.md`, `vodafone.md`
- **"Dark cinematic"** → `runwayml.md`, `elevenlabs.md`, `superhuman.md`, `shopify.md`
- **"Terminal / developer-native"** → `vercel.md`, `warp.md`, `voltagent.md`, `ollama.md`
- **"AI browser / agentic browser / product-app launch"** → `aside.md`, `raycast.md`, `superhuman.md`
- **"Warm / approachable / soft"** → `airbnb.md`, `notion.md`, `intercom.md`, `mastercard.md`
- **"Data-dense / dashboard"** → `sentry.md`, `kraken.md`, `posthog.md`, `clickhouse.md`
- **"Bold / sporty / monochrome punch"** → `nike.md`, `uber.md`, `tesla.md`, `binance.md`
- **"Playful / colorful / friendly"** → `figma.md`, `airtable.md`, `zapier.md`, `lovable.md`
