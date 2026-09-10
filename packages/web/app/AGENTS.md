# web/app — App Router Surface

## OVERVIEW

Next App Router routes, metadata, API handlers, and design-system entry styles; score 9, distinct route boundary.

## STRUCTURE

- `layout.tsx`, `globals.css`, `styles/` — document shell, fonts, global tokens, and design rules.
- `[locale]/` — localized landing, docs, and manifesto routes.
- `api/stats/` — formatted stats JSON; `api/npm-downloads/` — shields.io endpoint badge.
- `design/` — primitive showcase gated on `OMO_WEB_SHOWCASE=1`, excluded from the sitemap and marked non-indexable.
- `manifest.ts`, `robots.ts`, `sitemap.ts`, `opengraph-image.tsx`, `twitter-image.tsx` — metadata and social surfaces.

## WHERE TO LOOK

| Task                     | Location                                   | Notes                                                            |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| Change localized routing | `[locale]/layout.tsx`, `[locale]/page.tsx` | Keep next-intl locale loading and metadata aligned.              |
| Change docs behavior     | `[locale]/docs/`, `components/docs/`       | The docs shell owns the desktop content scroll region.           |
| Change live stats        | `api/stats/route.ts`, `../lib/stats.ts`    | Preserve fallback data and `Cache-Control` revalidation windows. |
| Change SEO/social output | metadata modules and `../lib/og/`          | Keep the design palette and generated font flow aligned.         |

## CONVENTIONS

- Route files are server-first; add client boundaries only for interactive components.
- User-facing copy belongs in locale message catalogs, not route JSX.
- Preserve `min-w-0`, responsive overflow handling, locale-prefixed links, and reduced-motion behavior.

## ANTI-PATTERNS

- Do not add `export const runtime = "edge"`.
- Do not hardcode localized copy or bypass the i18n routing helpers.
- Do not list the showcase route in the sitemap or remove its env gate.
- Do not introduce a second scroll owner for the docs content column.
