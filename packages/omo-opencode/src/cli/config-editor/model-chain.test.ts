import { describe, expect, test } from "bun:test"
import { changePrimary, readModelChain } from "./model-chain"

describe("editor model chains", () => {
  test("promotes a fallback without duplicates and keeps later entry metadata", () => {
    const fallback = { model: "provider/b", reasoning: "high" }
    const tail = { model: "provider/c", temperature: 0.7 }
    const source = ["provider/a", fallback, tail]
    expect(changePrimary(source, "provider/b")).toEqual([fallback, tail])
    expect(source).toEqual(["provider/a", fallback, tail])
  })

  test("replacing the primary preserves every secondary fallback", () => {
    expect(changePrimary(["provider/a", "provider/b", "provider/c"], "provider/d")).toEqual(["provider/d", "provider/b", "provider/c"])
  })

  test("understands canonical models before legacy model and fallback fields", () => {
    expect(readModelChain({ models: ["provider/new"], model: "provider/old", fallback_models: "provider/legacy" })).toEqual(["provider/new"])
    expect(readModelChain({ model: "provider/a", fallback_models: ["provider/b", { model: "provider/c", reasoning: "high" }] })).toEqual(["provider/a", "provider/b", { model: "provider/c", reasoning: "high" }])
    expect(readModelChain({ permission: { edit: "ask" } })).toEqual([])
  })
})

test("legacy primary settings travel with the model when appending or replacing", () => {
  const chain = readModelChain({ model: "provider/a", reasoning: "high", temperature: 0.4, top_p: 0.8, maxTokens: 1200, fallback_models: ["provider/b"] })
  expect(chain).toEqual([{ model: "provider/a", reasoning: "high", temperature: 0.4, top_p: 0.8, maxTokens: 1200 }, "provider/b"])
  expect(changePrimary(chain, "provider/c")).toEqual([{ model: "provider/c", reasoning: "high", temperature: 0.4, top_p: 0.8, maxTokens: 1200 }, "provider/b"])
})
