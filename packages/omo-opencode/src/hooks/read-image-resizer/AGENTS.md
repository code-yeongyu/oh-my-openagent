# src/hooks/read-image-resizer/ (Read Image Resizer)

**Generated:** 2026-08-17

## OVERVIEW

Tool Guard tier hook. Runs after `read` when the session model is `anthropic` and the output carries image attachments. Downscales images that exceed Anthropic's long-edge limit, removes ones it can't resize, and appends a `[Image Resize Info]` / `[Image Info]` appendix with dimensions plus token estimates.

## STRUCTURE

| File | Purpose |
|------|---------|
| `hook.ts` | `createReadImageResizerHook()`: filters `read` outputs, extracts image attachments, drives resize per attachment, mutates `attachment.url` in place, appends the info appendix |
| `image-resizer.ts` | `calculateTargetDimensions` (long-edge cap) + `resizeImage` via dynamically imported `sharp`; quality step-down 80/60/40 for jpeg/webp over the 5MB cap; falls back to pure JS on missing sharp |
| `image-dimensions.ts` | Signature-based width/height parsing from the first 32KB of base64 (PNG IHDR, GIF8 header, JPEG SOF scan, WebP VP8/VP8L/VP8X) |
| `png-fallback-resizer.ts` | Pure-JS PNG resize when sharp is unavailable: decode → nearest-neighbor → re-encode. PNG only, 8-bit depth only |
| `png-*.ts` | Fallback plumbing: chunk reader, CRC, IHDR parse, inflate/unfilter decoder, filter-0 encoder, nearest-neighbor, constants |
| `types.ts` | `ImageDimensions`, `ImageAttachment`, `ResizeResult` |

## FLOW

```
tool.execute.after (tool === "read", case-insensitive)
  → skip unless getSessionModel(sessionID).providerID === "anthropic"
  → extract attachments with mime ∈ {png, jpeg, gif, webp} and string url
  → per attachment:
      parse dims from base64 header → unparseable → "unknown-dims" entry
      long edge ≤ 1568 → "within-limits", untouched
      else resizeImage(sharp; PNG-only JS fallback)
        success → swap attachment.url to resized data URL
        failure → REMOVE attachment ("resize-skipped") to prevent API error
  → append info block; tokens = ceil(w*h / 750)
```

Thresholds: max long edge 1568px (aspect preserved, `fit: inside`), max encoded size 5MB (jpeg/webp only get quality retries; png/gif ship as-is).

## WIRING

Tool Guard tier, registered as `readImageResizer` in `src/plugin/hooks/create-tool-guard-hooks.ts`. Barrel export via `index.ts`.

## CONVENTIONS

- Every failure path returns `null` and logs with a `[read-image-resizer]` / `[png-fallback-resizer]` prefix; the hook never throws into the tool pipeline.
- `sharp` is optional. Loaded via dynamic `import()` behind `Function()` so bundlers don't hard-require it; `deps.loadSharpModule` is injectable for tests.
- Attachment objects are mutated in place (url swap, mime normalization) so OpenCode sees the change without re-building the output.
- Base64 helpers reuse `extractBase64Data` from `tools/look-at`.

## ANTI-PATTERNS

- Don't resize for non-Anthropic providers; other providers have different limits and the hook intentionally no-ops.
- Don't extend the JS fallback beyond 8-bit PNG without a real decoder; the current one only handles filter reconstruction + nearest-neighbor.
- Don't leave an oversized, unresizable attachment in place. Removal is deliberate: a too-large image hard-fails the Anthropic API call.
- Don't recompute token math elsewhere; the `/750` divisor lives here on purpose and only feeds the informational appendix.
