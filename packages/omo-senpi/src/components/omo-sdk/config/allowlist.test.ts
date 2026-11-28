import { describe, expect, test } from "bun:test"

import { describeModelChains } from "@oh-my-opencode/senpi-task/model-chains"
import { EMPTY_REGISTRY, isModelId } from "./allowlist"
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"

// A fixed-seed generator, so every run checks the same samples.
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const HEX = "0123456789abcdef"
const drawn = (random: () => number, alphabet: string, length: number): string =>
  Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")
const samples = (count: number, make: (random: () => number) => string, seed: number): readonly string[] => {
  const random = seeded(seed)
  return Array.from({ length: count }, () => make(random))
}

const uuid = (random: () => number): string => [8, 4, 4, 4, 12].map((length) => drawn(random, HEX, length)).join("-")

describe("the model-id gate", () => {
  test("#given credential shapes a model id could hide #when they are gated #then none passes", () => {
    // given
    const shapes: Readonly<Record<string, readonly string[]>> = {
      uuid: samples(300, uuid, 1),
      "provider/uuid": samples(300, (random) => `heroku/${uuid(random)}`, 2),
      "glpat- with 20 characters": samples(300, (random) => `glpat-${drawn(random, ALNUM, 20)}`, 3),
      "dash-separated hex groups": samples(300, (random) => [8, 8, 8].map((n) => drawn(random, HEX, n)).join("-"), 4),
      "tokens of 8 to 23 characters": samples(600, (random) => drawn(random, ALNUM, 8 + Math.floor(random() * 16)), 5),
      "40-character secret access keys": samples(
        2000,
        (random) => drawn(random, `${ALNUM}/`, 40).replace(/\/(?=.*\/)/g, "A"),
        6,
      ),
      "five-character key groups": samples(
        300,
        (random) => [5, 5, 5, 5, 5].map((n) => drawn(random, ALNUM.slice(0, 36), n)).join("-"),
        7,
      ),
    }

    // when
    const passed = Object.entries(shapes).flatMap(([shape, values]) =>
      values.filter((value) => isModelId(value)).map((value) => `${shape}: ${value}`),
    )

    // then
    expect(passed).toEqual([])
  })

  test("#given every model id the builtin chains and the engine's fallback chains name #when they are gated #then each passes", () => {
    // given
    const report = describeModelChains({}, EMPTY_REGISTRY)
    const ids = new Set([
      ...[...report.categories, ...report.agents].flatMap((entry) => entry.rungs.map((rung) => rung.model)),
      ...Object.entries(ENGINE_DEFAULT_FALLBACK_CHAINS).flatMap(([model, chain]) => [model, ...chain]),
      "openai/gpt-5.5",
      "anthropic/claude-haiku-5-5",
      "claude-3-5-sonnet-20241022",
      "meta-llama/Llama-3.1-70B-Instruct",
      "Qwen/Qwen3-235B-A22B",
      "deepseek-ai/DeepSeek-V3",
      "mistralai/Mixtral-8x7B-Instruct",
      "llama3.1:8b-instruct-q4_K_M",
      "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
      "system24-anthropic/claude-opus-5-5",
    ])

    // when
    const refused = [...ids].filter((id) => !isModelId(id))

    // then
    expect(ids.size).toBeGreaterThan(10)
    expect(refused).toEqual([])
  })
})
