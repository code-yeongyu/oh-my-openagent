# omo.json configuration

`omo.json` (or `omo.jsonc`, with comments and trailing commas) is the harness-neutral
config surface for the omo task and team runtime. The loader walks project `.omo/omo.jsonc`
then `.omo/omo.json` and merges the user config under the OS config directory
(`packages/omo-config-core/src/loader/paths.ts:29,51-54,74-77`).

## JSON schema and editor autocomplete

The generated JSON schema artifact lives at `assets/omo.schema.json` and is produced from
`OmoConfigSchema` (`packages/omo-config-core/src/schema/config.ts:7-13`) by the root
`build:omo-schema` script (`script/build-omo-schema.ts`,
`script/build-omo-schema-document.ts`). Point your editor at the raw dev-branch URL so it
validates and autocompletes the file:

```
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json
```

Add the URL through the `$schema` key. The schema declares `$schema` as an optional string
(`packages/omo-config-core/src/schema/config.ts:8,16`), so both the layer parse in the loader
(`packages/omo-config-core/src/loader/loader.ts:76`) and the final merged parse
(`packages/omo-config-core/src/loader/loader.ts:116`) accept and ignore the key rather than
rejecting the file.

## Example

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "categories": {
    "deep": {
      "description": "Deep analysis",
      "model": "anthropic/claude",
      "reasoningEffort": "high"
    }
  },
  "agents": {
    "reviewer": {
      "description": "Reviews code",
      "model": "openai/gpt-5",
      "execution_mode": "in-process"
    }
  },
  "task": {
    "default_execution_mode": "in-process",
    "default_concurrency": 5
  },
  "teams": {
    "builders": {
      "description": "Build team",
      "members": [
        { "name": "quick-one", "kind": "category", "category": "quick", "prompt": "Help" }
      ]
    }
  }
}
```

## Regenerating the schema

Run `bun run build:omo-schema` to regenerate `assets/omo.schema.json` from the current Zod
schema. Generation is deterministic, and the freshness guard
(`tests/omo-schema-freshness.test.ts`) fails when the committed artifact drifts from the
schema, mirroring how `bun run build:schema` maintains `assets/oh-my-opencode.schema.json`
(`.github/workflows/ci.yml:355-390` auto-commits both artifacts on `master` pushes).
