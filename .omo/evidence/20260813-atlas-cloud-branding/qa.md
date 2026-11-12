# Atlas Cloud branding QA

Date: 2026-08-13

## What was tested

- Parsed `.github/assets/atlas-cloud-logo.svg` and `.github/assets/atlas-cloud-logo-white.svg` with `xmllint`.
- Compared both repository-local SVG files byte-for-byte with the current official Atlas Cloud assets and checked their SHA-256 hashes.
- Requested the campaign-tagged Atlas Cloud homepage and coding-plan links with redirect following.
- Submitted the full `README.md` to GitHub's GFM renderer and asserted that the linked `<picture>` element, dark-theme source, fallback image, alt text, width, homepage destination, and coding-plan link survived rendering.
- Ran `git diff --check`, a targeted credential-pattern scan over added lines, and a file-scope review.

## What was observed

- Both SVG files are valid XML and match the official assets byte-for-byte.
- `atlas-cloud-logo.svg`: SHA-256 `f935e02b287d4571aca6ae5950829fff8905f909d2a1b00579cbfc5d6e2f6bad`.
- `atlas-cloud-logo-white.svg`: SHA-256 `72f824b46e57b581e12604b965db47b576041f66081791145d7f7b15a1a1f8e7`.
- The Atlas Cloud homepage and coding-plan links both returned HTTP 200.
- GitHub GFM preserved the dark-theme source, fallback logo, `Atlas Cloud` alt text, `width="163"`, clickable campaign destination, and coding-plan link.
- Whitespace and credential-pattern checks passed.
- This report covers the original branding slice only: `README.md` plus the two local logo assets. The later Atlas Cloud provider implementation has separate runtime QA evidence. Four unrelated CRLF-normalized evidence files were already dirty immediately after checkout and were explicitly excluded from staging.

## Why this is enough

For the branding slice, the observable behavior is GitHub README presentation and navigation. Exercising GitHub's own Markdown renderer, validating both link destinations, and proving that the local assets are valid official SVGs covers that slice. Provider registration, model routing, installation, cleanup, and generated runtime behavior are covered separately.

## What was omitted

- This branding report does not duplicate the provider runtime harness results; see the Atlas Cloud provider QA evidence added with the implementation.
- The full rendered HTML and full SVG bodies were not copied into this report; the focused assertions and hashes are sufficient and avoid noisy evidence.
- No credentials, environment dumps, authentication headers, or private values were captured.

## Residual risk

Only the canonical English README is updated to keep the branding PR small. The localized READMEs can be synchronized later if the maintainer requests it.
