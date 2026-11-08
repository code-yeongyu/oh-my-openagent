import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findNearestMessageExcludingCompaction,
  resolvePromptContextFromSessionMessages,
} from "./compaction-aware-message-resolver"

describe("compaction-aware message resolver variants", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "compaction-variant-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true })
  })

  test("#given newer same-model metadata explicitly carries high #when SDK history resolves #then newer variant wins", () => {
    // given
    const messages = [
      {
        info: {
          model: { providerID: "provider-a", modelID: "model-a", variant: "xhigh" },
        },
      },
      {
        info: {
          agent: "sisyphus",
          model: { providerID: "provider-a", modelID: "model-a", variant: "high" },
          tools: { bash: true },
        },
      },
    ]

    // when
    const result = resolvePromptContextFromSessionMessages(messages)

    // then
    expect(result).toEqual({
      agent: "sisyphus",
      model: { providerID: "provider-a", modelID: "model-a", variant: "high" },
      tools: { bash: true },
    })
  })

  test("#given newer model A metadata omits variant and older model B has xhigh #when SDK history resolves #then model A stays isolated without variant", () => {
    // given
    const messages = [
      {
        info: {
          model: { providerID: "provider-b", modelID: "model-b", variant: "xhigh" },
        },
      },
      {
        info: {
          agent: "atlas",
          model: { providerID: "provider-a", modelID: "model-a" },
          tools: { read: true },
        },
      },
    ]

    // when
    const result = resolvePromptContextFromSessionMessages(messages)

    // then
    expect(result).toEqual({
      agent: "atlas",
      model: { providerID: "provider-a", modelID: "model-a" },
      tools: { read: true },
    })
  })

  test("#given newer same-model metadata omits variant and older same-model metadata has xhigh #when SDK history resolves #then same-model variant backfills", () => {
    // given
    const messages = [
      {
        info: {
          model: { providerID: "provider-a", modelID: "model-a", variant: "xhigh" },
        },
      },
      {
        info: {
          agent: "sisyphus",
          model: { providerID: "provider-a", modelID: "model-a" },
          tools: { bash: true },
        },
      },
    ]

    // when
    const result = resolvePromptContextFromSessionMessages(messages)

    // then
    expect(result).toEqual({
      agent: "sisyphus",
      model: { providerID: "provider-a", modelID: "model-a", variant: "xhigh" },
      tools: { bash: true },
    })
  })

  test("#given newest model A omits variant between model B and older model A xhigh files #when filesystem history resolves #then same-model variant backfills past model B", () => {
    // given
    writeFileSync(join(tempDir, "001.json"), JSON.stringify({
      model: { providerID: "provider-a", modelID: "model-a", variant: "xhigh" },
    }))
    writeFileSync(join(tempDir, "002.json"), JSON.stringify({
      model: { providerID: "provider-b", modelID: "model-b", variant: "high" },
    }))
    writeFileSync(join(tempDir, "003.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "provider-a", modelID: "model-a" },
      tools: { read: true },
    }))

    // when
    const result = findNearestMessageExcludingCompaction(tempDir)

    // then
    expect(result).toEqual({
      agent: "atlas",
      model: { providerID: "provider-a", modelID: "model-a", variant: "xhigh" },
      tools: { read: true },
    })
  })
})
