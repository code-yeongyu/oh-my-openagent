/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateStandaloneParity } from "./generator"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone parity routing", () => {
  test("#given unified OpenCode agent and category models #when generating against the beta model catalog #then projects supported routes and reports optional misses", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-routing-"))
    roots.push(root)
    const configPath = join(root, "omo.jsonc")
    const outputRoot = join(root, "output")
    await writeFile(configPath, `{
      "[opencode]": {
        "default_run_agent": "build",
        "agents": { "build": { "model": "openai/gpt-5.6" }, "research": { "model": "anthropic/claude" } },
        "categories": { "quick": { "model": "openai/missing" } }
      }
    }`)

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      opencodeRoutingPath: configPath,
      availableModels: ["openai-codex/gpt-5.6", "anthropic/claude"],
    })

    // then
    expect(generated.routing).toEqual({
      routes: {
        agents: { build: "openai-codex/gpt-5.6", research: "anthropic/claude" },
        categories: {},
      },
      optionalMisses: ["category:quick"],
    })
  })

  test("#given an unavailable default OpenCode agent model #when generating #then rejects the mandatory route", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-routing-"))
    roots.push(root)
    const configPath = join(root, "omo.jsonc")
    await writeFile(configPath, `{"[opencode]":{"default_run_agent":"build","agents":{"build":{"model":"openai/missing"}}}}`)

    // when
    const generated = generateStandaloneParity({
      outputRoot: join(root, "output"),
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      opencodeRoutingPath: configPath,
      availableModels: ["openai-codex/gpt-5.6"],
    })

    // then
    await expect(generated).rejects.toThrow("mandatory route unavailable: build")
  })

  test("#given the subscription-backed beta provider #when projecting an OpenAI route #then selects the available provider alias", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-parity-routing-"))
    roots.push(root)
    const configPath = join(root, "omo.jsonc")
    await writeFile(configPath, `{"[opencode]":{"default_run_agent":"build","agents":{"build":{"model":"openai/gpt-5.6-sol"}}}}`)

    // when
    const generated = await generateStandaloneParity({
      outputRoot: join(root, "output"),
      skillRoots: [],
      commandRoots: [],
      instructionPaths: [],
      opencodeRoutingPath: configPath,
      availableModels: ["chatgpt-subscription/gpt-5.6-sol"],
    })

    // then
    expect(generated.routing.routes.agents).toEqual({ build: "chatgpt-subscription/gpt-5.6-sol" })
  })
})
