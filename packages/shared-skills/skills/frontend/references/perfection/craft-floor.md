# Craft floor: the numbers a build must clear

Adapted from the `craft-floor` reference of [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0, Copyright 2025 Paul Bakaus), rewritten for this skill; see `ATTRIBUTION.md` section 6 for the license and the list of changes.

Read this with `README.md` for any code change. It sets no direction, and it has two kinds of line. Each line is checked on the rendered page by reading computed values, not by looking at the source. `/visual-qa` checks them again (A3, A13, B8, E7, F8, F9).

- **Floors** (marked *floor* below) hold under every style skill and brand. A project's `DESIGN.md` may raise them, never lower them.
- **Defaults** (every other line) hold until the brief asks otherwise. That means the brief's own words, a concrete reference, or a route the brief chose that names the value or pattern: a Layer A style skill or Layer B brand under `references/design/`, or the ambience route. Brutalist display scale and tracking, a brand's labels above headings, and the ambience route's blur reveals and glowing-border cards are examples. The route wins for that one item only. Record the deviation in the brief or `DESIGN.md` so `/visual-qa` reads it as chosen, not generated.

## Browser surfaces

*Floor.* The parts of a page the browser draws by default ship with no design unless you give them one. Theme every one that the surface has, from the palette tokens, in both themes:

| Surface | What to set |
|---|---|
| Text selection | `::selection { background: <accent at low alpha>; color: <ink> }`; the default system blue never shows. |
| Caret | `caret-color: <accent or ink>` on inputs, textareas and contenteditable. |
| Scrollbars | `scrollbar-color: <thumb> <track>` and `scrollbar-width: thin` on scroll containers that keep a visible bar. Overlay scrollbars stay overlay (`/visual-qa` A5); this styles the bar, it never adds a gutter. |
| Focus ring | `:focus-visible { outline: 2px solid <focus token>; outline-offset: 2px }`, visible on every surface colour. |
| Underlines | `text-underline-offset: 0.15em` to `0.25em` and `text-decoration-thickness` from the type scale on links, so the line clears descenders. |
| Numerals | `font-variant-numeric: tabular-nums` on every column, counter, timer, price and table cell that changes or aligns. |

Exempt: a surface with no instance of the element (no inputs means no caret), and a native control the brief keeps unstyled on purpose.

## Type and spacing floor

| Rule | Floor | Read from |
|---|---|---|
| Type scale steps (*floor*) | Each step of the heading ladder (display, h1, h2, h3) and the step from the smallest heading to body differ by at least 1.25x in size. The body-family roles (lead, body, small, caption, overline or label) may sit closer, but each also differs from its neighbour by weight, colour or case, never by size alone. | computed `font-size` of each role in use |
| Space around a heading | The space above a section heading is at least 1.5x the space below it, so the heading belongs to the content it introduces. | computed margin/padding plus the parent gap |
| Group separation | The gap between groups is at least 2x the gap inside a group. | computed `gap` / margins of siblings |
| Body measure (*floor*) | Body text runs 65-75 characters per line on desktop; 45 is the lower bound on a phone. | rendered line length at 1440 and 390 |
| Display size | A display heading stays at or under 6rem unless the chosen route sets a larger display scale. | computed `font-size` |
| Tracking | Letter spacing stays at or above -0.04em unless the chosen route sets tighter display tracking; -0.02em to -0.03em usually reads better on large type. Body text keeps 0. | computed `letter-spacing` / `font-size` |

Run the real copy at every captured width and fix what overflows or wraps a heading to four lines.

## Patterns kept out of the first draft

These extend the Draft guard in `SKILL.md`. Each one is what a generator reaches for when nothing decided otherwise, so the first draft leaves it out. The brief or its chosen route can still ask for one (see the defaults rule above). The hard offset shadow below is narrower than that.

- **Kicker above a heading.** A small uppercase or accent label sitting on top of a heading ("FEATURES", "01 - OVERVIEW"). Delete it; the heading carries its own weight.
- **Icon in a tile over a heading.** A rounded square holding an icon, stacked above a heading and a line of text, repeated across a grid of same-size cards. Use the content's own structure (a list, a table, a real image) instead of the card formula.
- **Hero metric.** One giant number with a small label, flanked by supporting stats and an accent. A number earns that size only when it is the decision the screen exists for.
- **Cards inside cards.** A bordered or shadowed box inside another. Separate inner groups with space or a neutral 1px rule.
- **Gray text on a coloured surface.** Secondary text on a tinted or coloured background takes a shade of that hue (or the foreground at reduced alpha), never neutral gray, which looks dirty and fails contrast first.
- **Monospace as a costume.** A monospace face only for code, data, ids and measurements, never to make a heading or a UI read as "technical".
- **Glow and halo shadows.** A shadow carries a y-offset and a soft blur. A zero-offset coloured glow around a card or button is decoration, unless the brief asked for glowing-border cards through the ambience route. Hard offset shadows with no blur (`4px 4px 0`) only when the brief chose a neobrutalist direction.

## What this skill does not take from the source

The upstream reference disagrees with rules this skill already holds; ours win:

- Blur, `backdrop-filter` and `filter: blur()` are not general motion materials. They animate only in an ambience reveal the brief asked for (`references/design/ambience-skill.md`), and never under `prefers-reduced-motion` (`/visual-qa` G4).
- A label above a heading is a default to leave out, not an absolute ban: a style route that allows a limited number of them (`taste-skill.md`) is followed.
- Both light and dark themes ship (`/visual-qa` E1); the theme is not picked per product category.
- An intentional spring is allowed where `DESIGN.md` names it; bounce easing is a finding only when no token asked for it.
- A typeface the project chose (for example Inter in a product that matches its platform) is never a finding because it is common.
- Scrollbars follow the overlay rule above; this skill never asks for a decorative custom scrollbar.
