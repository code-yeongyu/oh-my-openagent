import { describe, expect, test } from "bun:test"

import { resolveTaskAgents } from "./task-agents"

describe("resolveTaskAgents", () => {
  test("#given a markdown agent and an omo.json entry for it #when resolving #then omo.json fields win and the rest of the file is kept", () => {
    // given
    const markdownAgents = {
      "pr-writer": {
        name: "pr-writer",
        description: "Writes PRs",
        prompt: "file prompt",
        model: "provider/file-model",
      },
    }

    // when
    const agents = resolveTaskAgents({ agents: { "pr-writer": { model: "provider/config-model" } } }, markdownAgents)

    // then
    expect(agents["pr-writer"]?.model).toBe("provider/config-model")
    expect(agents["pr-writer"]?.prompt).toBe("file prompt")
    expect(agents["pr-writer"]?.description).toBe("Writes PRs")
  })

  test("#given a markdown agent named after a curated builtin #when resolving #then it overlays the builtin and stays in-process", () => {
    // given
    const markdownAgents = { explore: { name: "explore", model: "provider/file-model", executionMode: "process" } }

    // when
    const agents = resolveTaskAgents({}, markdownAgents)

    // then
    expect(agents.explore?.model).toBe("provider/file-model")
    expect(agents.explore?.executionMode).toBe("in-process")
    expect(agents.explore?.tools).toBeDefined()
  })
})
