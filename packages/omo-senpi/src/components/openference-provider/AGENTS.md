# openference-provider

Credential-gated IN-MEMORY registration of the [Openference](https://openference.com)
provider (an OpenAI-compatible gateway serving curated open-source models) through
`pi.registerProvider(createProvider(...))` — no user-config mutation, nothing persisted:
when the credential is gone on the next load, the provider is simply not registered.
The OpenCode edition ships the same gateway via
`packages/omo-opencode/src/features/openference-provider/`.

## Files

| Path | Purpose |
|------|---------|
| `index.ts` | Component factory `createOpenferenceProviderComponent(options)`; builds the complete pi-ai Provider and registers it on load |
| `auth.ts` | `hasOpenferenceCredential`: `OPENFERENCE_API_KEY` env var or an `openference` entry in `<agentDir>/auth.json` (exactly the shapes `/login` writes: `type: api_key` or `oauth`) |
| `types.ts` | Committed-catalog entry shape (Pi models.json model-entry form) |
| `openference-senpi-models.json` | Generated catalog; refresh with `bun run packages/omo-senpi/scripts/generate-openference-models.ts` |
| `../../../scripts/generate-openference-models.ts` | Generator mapping the public unauthenticated `GET /v1/models` listing onto the entry shape (gates: text output, `tool_calling === true`, both limits published; emits `thinkingLevelMap` from published efforts) |

## Behavior

- **Gate:** registration happens at EXTENSION LOAD (x-search pattern). Without a
  credential the component logs on the debug channel and registers nothing. Gated by
  the standard `omo-senpi-openference-provider-disabled` flag via the composition layer.
- **In-memory only:** the provider is registered through the engine's provider
  registration API; `models.json` and every other user-config file are never read for
  writing, created, or mutated. Hosts without `registerProvider` (older engines) get a
  warn-level skip via feature detection, not a failure.
- **Request auth is engine-owned:** `auth.apiKey.resolve` merges the stored `/login`
  credential with the env var per field (`credential.key ?? env("OPENFERENCE_API_KEY")`),
  so both credential paths work identically and no key value ever lands in config.
  `/login openference` prompts for the key through the registered `login` flow
  (useful for rotation or moving from env to stored). With no resolvable credential the
  provider reports unauthenticated and the engine owns model availability.
- **Required header:** the provider carries `User-Agent: pi/openference` — Openference
  rejects requests without a `pi/` User-Agent with 403 "coding agent required".
- **Catalog:** committed, generated from the live listing; models complete into full
  pi-ai Model objects at registration (api/provider/baseUrl filled from the block).
  `cacheWrite` cost stays at the zero default (Openference publishes no cache-write rate).

## Notes

- Catalog model ids are not owner-prefixed and contain spaces (`Kimi K2.7 Code`,
  `SenseNova 6.8 Flash-Lite`); quote them in CLI selections:
  `senpi -p --provider openference --model "Kimi K2.7 Code" ...`.
- The live listing is the source of truth for reasoning control (it may disagree with
  Openference's static docs tables); the generator follows the listing.
