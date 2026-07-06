# pi-webfetch

URL retrieval as a Pi extension, vendored from the standalone
`code-yeongyu/pi-webfetch` repository into this monorepo as
`@oh-my-opencode/pi-webfetch` (private workspace package, Adapter layer:
Pi-harness-coupled).

Registers one LLM-callable tool, `webfetch`, which fetches a URL and returns its
content as markdown (HTML converted via turndown), plain text, or raw HTML, with
bounded timeout and a 5 MB response-size cap. Toggle off with `PI_WEBFETCH=0`.

## Anatomy

| Path | Purpose |
|------|---------|
| `src/index.ts` | Extension entry: `PI_WEBFETCH` toggle + tool registration + UI clearing on session lifecycle |
| `src/webfetch/tool.ts` | `webfetch` tool definition (typebox params, execute) |
| `src/webfetch/fetcher.ts` | Bounded fetch: URL validation, timeout, size cap, Cloudflare-challenge retry |
| `src/webfetch/content.ts` | HTML -> markdown (turndown) and HTML -> text conversion + entity decoding |
| `src/webfetch/renderers.ts` | TUI call/result renderers |
| `src/webfetch/errors.ts` | Typed fetch errors |
| `test/` | Vendored suite (bun:test): real HTTP fixture server + tool-definition + toggle tests |
| `scripts/qa/drive.mjs` | Live QA driver: real pi CLI (RPC mode) fetching a local HTTP fixture, `--self-test` |
| `scripts/qa/mock-provider/` | Self-contained scripted provider extension (no network to the model, no keys) |

## Conventions

- Vendored source: keep diffs against upstream intentional and reviewable. Tests
  were converted vitest -> bun:test; the HTTP-fixture teardown was hardened to
  destroy tracked sockets directly because Bun's fetch pools a cancelled socket
  (so `server.close()` would otherwise hang), and the two oversized tests plus the
  Cloudflare-challenge test drop the undici-specific server-side socket-close
  proxy in favor of asserting the production contract (reject oversized, retry
  past the challenge).
- `turndown` is a real runtime dependency. Peer deps (`@mariozechner/pi-*`,
  `typebox`) resolve from the host Pi runtime; pinned devDependencies exist only
  for typecheck + tests + live QA.
- Not wired into any OpenCode/Codex/omo-senpi component. Ships as a standalone Pi
  package surface (`pi.extensions` manifest field).

## QA

```sh
bun test packages/pi-webfetch                      # unit + real-HTTP-fixture gate
tsgo --noEmit -p packages/pi-webfetch/tsconfig.json
node packages/pi-webfetch/scripts/qa/drive.mjs --self-test
node packages/pi-webfetch/scripts/qa/drive.mjs     # live pi-harness proof (RPC mode, sandboxed)
```

The live driver is the real-harness gate: it drives the real pi CLI to call
`webfetch` against a local fixture and asserts the HTML-to-markdown result.
Evidence goes to `.omo/evidence/<date>-<slug>/`.
