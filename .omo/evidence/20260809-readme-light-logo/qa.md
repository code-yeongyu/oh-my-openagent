# README Light Logo QA

## What was tested

- Compared `.github/assets/omo-icon-light.svg` with the source asset from
  `sisyphuslabs-web/public/assets/omo-icon-light.svg` using SHA-256.
- Parsed the committed SVG with `xmllint --noout`.
- Checked every root README translation for the new
  `./.github/assets/omo-icon-light.svg` reference and confirmed the target file
  exists.
- Rendered the committed SVG through macOS Quick Look at 512 px and inspected
  the resulting PNG.

## What was observed

- Source and committed SHA-256:
  `0cb99c9fc750827f2c35ae99659de6d40e03ae7b1d79d3c29f1002017fe33b0a`.
- XML parsing completed without errors.
- `README.md`, `README.ko.md`, `README.ja.md`, `README.ru.md`, and
  `README.zh-cn.md` all resolve to the tracked light SVG.
- The rendered image was 512 x 512 with alpha and visibly showed the intended
  dark OmO cat mark on the light rounded-square background, with no clipping or
  malformed paths.
- Manual render artifact during QA:
  `/tmp/omo-light-logo-qa/omo-icon-light.svg.png`.

## Why it is enough

The exact source hash proves the committed file is the requested light asset.
Parsing and path-resolution checks cover broken-file and broken-link risks.
The rendered image inspection covers the user-visible README logo surface.

## What was omitted

- The temporary rendered PNG is not committed because it is a derived QA
  artifact and the source SVG is the shipped asset.
- No credentials, environment dumps, or private logs were captured.
