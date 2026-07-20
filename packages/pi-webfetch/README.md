# pi-webfetch

Web fetch tool extension for the [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). It retrieves a URL and returns the response as markdown, plain text, or raw HTML with bounded timeout and response-size controls.

## Origin

This package follows the pi extension structure used by [pi-lsp-client](https://github.com/code-yeongyu/pi-lsp-client) and mirrors the simple `webfetch` contract from [opencode](https://github.com/sst/opencode): `url`, optional `format`, and optional `timeout`.

## Quick Demo

```text
> Fetch https://example.com as markdown.

[webfetch] https://example.com [markdown]
200 OK • markdown • 1.2 KB converted
  # Example Domain
  This domain is for use in illustrative examples in documents.
```

```text
> Fetch https://example.com as html.

[webfetch] https://example.com [html]
200 OK • html • 1.2 KB
  <!doctype html>
  <html>
```

## Installation

The package targets the [`pi`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) coding agent. Pi loads extensions from `~/.pi/agent/extensions/`, project `.pi/extensions/`, or via the `--extension` / `-e` CLI flag.

```bash
# 1. From npm (once published)
pi install npm:@code-yeongyu/pi-webfetch

# 2. From git
pi install git:github.com/code-yeongyu/pi-webfetch

# 3. Manual placement
git clone https://github.com/code-yeongyu/pi-webfetch ~/.pi/agent/extensions/pi-webfetch
cd ~/.pi/agent/extensions/pi-webfetch && npm install

# 4. Dev / one-shot test
pi -e /path/to/pi-webfetch/src/index.ts
```

After installation, restart pi or run `/reload` inside an interactive session. The `webfetch` tool registers automatically.

## Tools

### `webfetch`

Fetches content from a URL and returns it in the requested format. The tool is read-only and does not modify files.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` (required) | URL to fetch. Must start with `http://` or `https://`. |
| `format` | `"markdown" \| "text" \| "html"` (optional) | Output format. Default `markdown`. |
| `timeout` | `number` (optional) | Timeout in seconds. Defaults to `30`; capped at `120`. |

HTML responses are converted when `format` is `markdown` or `text`. Non-HTML responses are returned as decoded UTF-8. Raw HTML is returned unchanged when `format` is `html`.

## Behavior

- **Timeout:** 30 seconds by default, capped at 120 seconds.
- **Response size:** 5 MB maximum, checked by `Content-Length` and while reading the body.
- **Accept negotiation:** sends an `Accept` header weighted for the requested format.
- **User-Agent:** uses a browser-like user agent, with one Cloudflare challenge retry using `pi-webfetch`.
- **TUI rendering:** compact output shows status, format, size, conversion state, and a short preview; expanded output includes final URL and content type.

## Development

```bash
git clone https://github.com/code-yeongyu/pi-webfetch
cd pi-webfetch
npm install
npm test
npm run typecheck
npm run check
pi -e ./src/index.ts
```

The test suite uses vitest. Test descriptions follow `#given .. #when .. #then` style; bodies use plain `// given / // when / // then` comments. TypeScript is strict, Node-only, and uses ESM imports with `.js` suffixes.

## License

[MIT](LICENSE).

## Related

- [senpi](https://github.com/code-yeongyu/senpi) — the fork/runtime these extensions are extracted from.
- [Ultraworkers Discord](https://discord.gg/PUwSMR9XNk) — community link from the senpi README.
- [Dori](https://sisyphuslabs.ai) — the product powered by senpi under the hood.

## Acknowledgements

- **Mario Zechner** ([@badlogic](https://github.com/badlogic)) — author of [pi-mono](https://github.com/badlogic/pi-mono) and the pi-coding-agent extension API this package targets.
- **opencode** — reference behavior for the `webfetch` URL/format/timeout contract.
