import { describe, expect, test } from "bun:test"

import {
  transformConfigJsoncSources,
  type DiscoveredLegacyConfigSource,
} from "./index"
import { transformReasoningUnification } from "./reasoning-unification"

const configSource: DiscoveredLegacyConfigSource = {
  configPath: "/home/alice/.omo/config.jsonc",
  kind: "config-jsonc",
  path: "/home/alice/.omo/config.jsonc",
  precedence: 0,
}

describe("config.jsonc migration transform", () => {
  test("#given both [omo] and [senpi] blocks #when transforming config.jsonc #then [native] wins and the overlap is diagnostic", () => {
    // given
    const sources = [{
      path: configSource.path,
      value: {
        $schema: "https://legacy.example/config.schema.json",
        "[opencode]": { nested: { value: true } },
        "[codex]": { disabled_hooks: ["startup-toast"] },
        "[omo]": { agents: { oracle: { model: "legacy" } } },
        "[senpi]": { agents: { oracle: { model: "current" } } },
        _migrations: ["legacy-file-marker"],
        appliedMigrations: ["legacy-top-level-marker"],
      },
    }]

    // when
    const result = transformConfigJsoncSources({ discovered: [configSource], sources })

    // then
    expect(result.document).toEqual({
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
      "[opencode]": { nested: { value: true } },
      "[codex]": { disabled_hooks: ["startup-toast"] },
      "[native]": { agents: { oracle: { model: "current" } } },
      legacy_migrations: {
        "/home/alice/.omo/config.jsonc": ["legacy-file-marker", "legacy-top-level-marker"],
      },
    })
    expect(result.diagnostics).toEqual([
      "conflict: [native] legacy [omo] kept [native]",
    ])
  })

  test("#given a legacy document carrying a [senpi] block #when transforming config.jsonc #then the harness key is [native] and every value is preserved", () => {
    // given
    const senpiBlock = {
      agents: { oracle: { model: "current" } },
      categories: { deep: { model: "deep-model" } },
      telemetry: { enabled: true },
    }
    const sources = [{
      path: configSource.path,
      value: { "[senpi]": senpiBlock },
    }]

    // when
    const result = transformConfigJsoncSources({ discovered: [configSource], sources })

    // then
    expect(result.document).toEqual({
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
      "[native]": senpiBlock,
    })
    expect(result.document["[senpi]"]).toBeUndefined()
  })

  test("#given a [native] block with retired reasoning spellings #when unifying #then it is normalized exactly as [senpi] is", () => {
    // given
    const retired = { categories: { deep: { model: "p/m high", variant: "low" } } }
    const normalized = { categories: { deep: { model: "p/m:high", reasoning: "low" } } }

    // when
    const nativeResult = transformReasoningUnification({ "[native]": retired })
    const senpiResult = transformReasoningUnification({ "[senpi]": retired })

    // then
    expect(nativeResult.document).toEqual({ "[native]": normalized })
    expect(senpiResult.document).toEqual({ "[senpi]": normalized })
    expect(nativeResult.document["[native]"]).toEqual(senpiResult.document["[senpi]"])
  })
})
