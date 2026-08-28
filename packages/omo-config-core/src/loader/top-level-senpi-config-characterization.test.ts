import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOmoConfig, type OmoConfig } from "../index"

const QUICK_PROMPT_APPEND = `<Execution_Style>
EVAL-FIRST: \`eval\` is your default execution surface. Before acting, ask "how do I finish this whole step in ONE parallelized eval cell?" - then write that cell.

- One cell = one full wave: enumerate every independent lookup (file reads, \`rg\` searches, git queries, metadata), run them ALL concurrently (Python: \`concurrent.futures.ThreadPoolExecutor\` + \`subprocess\`; JS: \`parallel(thunks)\`), then filter, chain, dedupe, and aggregate INSIDE the kernel with comprehensions. Return only distilled facts, never raw dumps.
</Execution_Style>`

const CURRENT_USER_CONFIG = `{
  "categories": {
    "quick": {
      "model": "kimi-coding/kimi-for-coding-highspeed-unlocked",
      "reasoningEffort": "minimal",
      "fallback_models": [
        { "model": "openai-codex/gpt-5.6-luna-fast", "reasoningEffort": "minimal" },
        { "model": "example-gateway/z-ai/glm-5.2-ultrafast-unlocked", "reasoningEffort": "none" }
      ],
      "prompt_append": ${JSON.stringify(QUICK_PROMPT_APPEND)}
    },
    "deep": {
      "model": "openai-codex/gpt-5.6-terra",
      "variant": "xhigh"
    }
  },
  "agents": {
    "explore": {
      "model": "kimi-coding/kimi-for-coding-highspeed",
      "models": [
        { "model": "openai-codex/gpt-5.6-luna-fast", "reasoningEffort": "minimal" },
        "example-gateway/z-ai/glm-5.2-ultrafast-unlocked",
        { "model": "openai-codex/gpt-5.6-luna-fast", "reasoningEffort": "minimal" }
      ]
    },
    "oracle": {
      "model": "openai-codex/gpt-5.6-sol",
      "reasoningEffort": "max"
    }
  }
}`

const EXPECTED_CONFIG = {
  agents: {
    explore: {
      model: "kimi-coding/kimi-for-coding-highspeed",
      models: [
        { model: "openai-codex/gpt-5.6-luna-fast", reasoning: "minimal" },
        "example-gateway/z-ai/glm-5.2-ultrafast-unlocked",
        { model: "openai-codex/gpt-5.6-luna-fast", reasoning: "minimal" },
      ],
    },
    oracle: {
      model: "openai-codex/gpt-5.6-sol",
      reasoning: "max",
    },
  },
  categories: {
    quick: {
      fallback_models: [
        { model: "openai-codex/gpt-5.6-luna-fast", reasoning: "minimal" },
        { model: "example-gateway/z-ai/glm-5.2-ultrafast-unlocked", reasoning: "off" },
      ],
      model: "kimi-coding/kimi-for-coding-highspeed-unlocked",
      prompt_append: QUICK_PROMPT_APPEND,
      reasoning: "minimal",
    },
    deep: {
      model: "openai-codex/gpt-5.6-terra",
      reasoning: "xhigh",
    },
  },
  codegraph: {
    auto_provision: true,
    daemon: true,
    enabled: true,
    telemetry: false,
  },
  task: {
    default_concurrency: 5,
    global_concurrency: Math.max(8, availableParallelism() * 2),
    default_execution_mode: "in-process",
    max_depth: 1,
    residency_max_children: Math.max(8, availableParallelism() * 3),
    resume_children: true,
    team: {
      max_members: 8,
      max_parallel_members: 4,
      max_wall_clock_minutes: 120,
    },
    ttl_ms: 86_400_000,
    wait: {
      default_ms: 60_000,
      max_ms: 600_000,
      min_ms: 5_000,
    },
    warnings: {
      unavailable_categories: true,
    },
  },
  teams: {},
} satisfies OmoConfig

describe("loadOmoConfig top-level Senpi configuration characterization", () => {
  test("#given the current top-level-only user config shape #when resolving the senpi view #then category and agent settings are preserved exactly", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-config-top-level-senpi-"))
    const homeDir = join(root, "home")
    const cwd = join(homeDir, "project")
    mkdirSync(join(homeDir, ".omo"), { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(homeDir, ".omo", "omo.jsonc"), CURRENT_USER_CONFIG)

    try {
      // when
      const result = loadOmoConfig({
        cwd,
        env: { HOME: homeDir },
        harness: "senpi",
        platform: "linux",
      })

      // then
      expect(result.diagnostics).toEqual([])
      expect(result.config).toEqual(EXPECTED_CONFIG)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
