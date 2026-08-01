import { describe, expect, test } from "bun:test"

import {
  transformConfigJsoncSources,
  type DiscoveredLegacyConfigSource,
} from "./index"

const configSource: DiscoveredLegacyConfigSource = {
  configPath: "/home/alice/.omo/config.jsonc",
  kind: "config-jsonc",
  path: "/home/alice/.omo/config.jsonc",
  precedence: 0,
}

describe("config.jsonc migration transform", () => {
  test("#given both [omo] and [senpi] blocks #when transforming config.jsonc #then [senpi] wins and the overlap is diagnostic", () => {
    // given
    const sources = [{
      path: configSource.path,
      value: {
        $schema: "https://legacy.example/config.schema.json",
        codegraph: { excluded_roots: ["/generated"] },
        "[opencode]": { nested: { value: true } },
        "[codex]": { codegraph: { daemon: false } },
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
      codegraph: { excluded_roots: ["/generated"] },
      "[opencode]": { nested: { value: true } },
      "[codex]": { codegraph: { daemon: false } },
      "[senpi]": { agents: { oracle: { model: "current" } } },
      legacy_migrations: {
        "/home/alice/.omo/config.jsonc": ["legacy-file-marker", "legacy-top-level-marker"],
      },
    })
    expect(result.diagnostics).toEqual([
      "conflict: [senpi] legacy [omo] kept [senpi]",
    ])
  })
})
