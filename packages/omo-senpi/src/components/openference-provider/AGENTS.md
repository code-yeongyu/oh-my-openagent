# openference-provider

Credential-gated registration of the [Openference](https://openference.com) provider (an
OpenAI-compatible gateway serving curated open-source models) into the engine's
`models.json` (Pi `docs/models.md` provider-config form), so a credentialed machine gets
the full model catalog with correct context windows and costs without hand-writing
config. The OpenCode edition ships the same provider via
`packages/omo-opencode/src/features/openference-provider/`.

## Files

| Path | Purpose |
|------|---------|
| `index.ts` | Component factory `createOpenferenceProviderComponent(options)`; load-time, synchronous, atomic write |
| `auth.ts` | `hasOpenferenceCredential`: `OPENFERENCE_API_KEY` env var or an `openference` entry in `<agentDir>/auth.json` (shape-tolerant: any object entry with a `type` or `apiKey` field) |
| `merge.ts` | Pure `mergeOpenferenceProvider(existing, catalog)` with fill-only-missing semantics + the shared constants |
| `types.ts` | Pi model-entry shape (`OpenferenceSenpiModelEntry`, `OpenferenceSenpiCatalog`) |
| `openference-senpi-models.json` | Generated catalog; refresh with `bun run packages/omo-senpi/scripts/generate-openference-models.ts` |
| `../../../scripts/generate-openference-models.ts` | Generator mapping the public unauthenticated `GET /v1/models` listing onto the Pi entry shape (gates: text output, `tool_calling === true`, both limits published; emits `thinkingLevelMap` from published efforts) |

## Behavior

- **Gate:** registration happens at EXTENSION LOAD (x-search pattern). Without a
  credential the component logs on the debug channel and returns: `models.json` is never
  created or touched. Gated by the standard `omo-senpi-openference-provider-disabled`
  flag via the composition layer.
- **Merge:** fill-only-missing at every level - provider fields, header values
  (one level deep), and whole model entries identified by `id`. A user-pinned model
  entry always wins; catalog ids the user's list lacks are appended. When nothing is
  missing the file is left byte-identical (no write).
- **Abort, never clobber:** unparsable `models.json`, a non-object `providers` record, a
  non-object `openference` slot, or a non-array `models` under `openference` each log a
  warning and leave the file untouched.
- **Write:** temp file + rename in the agent dir (atomic), 2-space indent, trailing
  newline. The engine reloads `models.json` on every `/model` open, so no restart is
  needed.
- **Provider block:** `baseUrl https://api.openference.com/v1`, `api openai-completions`,
  `apiKey $OPENFERENCE_API_KEY` (engine env interpolation), and the
  `User-Agent: pi/openference` header - Openference rejects requests without a `pi/`
  User-Agent with 403 "coding agent required".
- **Removal never happens:** a credential that disappears later leaves the block in place
  for the user to manage (same invariant as the OpenCode side).

## Conventions

- The generated catalog is committed; the generator is a standalone Bun executable run
  by path, mirroring `packages/omo-opencode/scripts/generate-opengateway-models.ts`.
  Catalog model IDs contain spaces (e.g. `Kimi K2.7 Code`) - Openference ids are not
  owner-prefixed.
- `cacheWrite` cost stays at the zero default: Openference publishes no cache-write rate,
  and borrowing the input rate would misreport usage.
- The live listing is the source of truth for reasoning control (it may disagree with
  Openference's static docs tables); the generator follows the listing.
