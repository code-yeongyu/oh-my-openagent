# `idm openai-compat`

Launches the probe-lab `openai-compat` HTTP sidecar so external clients (9router, OpenCode, raw curl) can route OpenAI-format `/v1/chat/completions` requests through the DeepSeek-web reverse stack (PoW, AWS WAF cookies, account pool, capability resolver).

## Usage

```bash
bunx idm openai-compat serve --port 28128
```

First run auto-generates a bearer token at `~/.config/idm/openai-compat.bearer` (mode 0600) and prints it together with the listen URL.

| Flag | Env var | Default | Notes |
|---|---|---|---|
| `--port <n>` | — | `28128` | Loopback TCP port |
| `--host <host>` | — | `127.0.0.1` | Bind host |
| `--bearer <token>` | `IDM_OPENAI_COMPAT_BEARER` | auto-generated | Inbound bearer (NOT logged to disk when supplied explicitly) |
| `--providers <ids>` | `IDM_OPENAI_COMPAT_PROVIDER_IDS` | `deepseek-web` | Comma-separated probe-lab provider ids |
| — | `IDM_OPENAI_COMPAT_BEARER_FILE` | `~/.config/idm/openai-compat.bearer` | Override bearer secret file path |
| — | `IDM_PROBE_LAB_CURL_CFFI_AUTO` | unset | Set to `1` to auto-register the curl-cffi driver on first dispatch (required for live DeepSeek traffic) |
| — | `IDM_PROBE_LAB_CAMOUFOX_AUTO` | unset | Set to `1` to auto-register the Camoufox driver (PoW / WAF fallback) |

## Adding to 9router

`decolua/9router` is launched separately on `localhost:20128`. Add the idm sidecar as a **Custom OpenAI-compatible provider** in the 9router dashboard:

- **Base URL:** `http://127.0.0.1:28128/v1`
- **API Key:** the bearer printed at startup (or `cat ~/.config/idm/openai-compat.bearer`)
- **Models:** `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-vision`

This is the **option 4 / no-fork** integration path: the sidecar owns all DeepSeek-web reverse-engineering complexity (PoW solver, SPA headers, capability matrix, account pool). 9router only sees a generic OpenAI endpoint and is never patched, so `brew upgrade 9router` cannot break the integration.

## Smoke test

```bash
BEARER=$(cat ~/.config/idm/openai-compat.bearer)
curl -sN http://127.0.0.1:28128/v1/chat/completions \
  -H "Authorization: Bearer $BEARER" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","stream":false,"messages":[{"role":"user","content":"PONG?"}]}'
```

## Files

- `index.ts` — Commander wrapper exposing `idm openai-compat serve`
- `serve.ts` — Boot logic (env wiring, startup summary, SIGINT/SIGTERM, waitForever)
- `bearer-resolver.ts` — Bearer resolution: `--bearer` > env > file > auto-generate
