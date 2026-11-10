/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { confirmRequestedModels } from "./available-models"

const client = (rows: Array<{ provider: string; id: string }>, calls: { n: number }) => ({
  model: { list: async () => { calls.n++; return { data: rows } } },
}) as never

describe("a partial cached catalog does not hide a requested model", () => {
  const cached = new Set(["fixture/model-a", "fixture/model-b", "fixture/model-c"])

  test("a requested model the cache lacks is confirmed against the live catalog", async () => {
    const calls = { n: 0 }
    const out = await confirmRequestedModels(client([{ provider: "fixture", id: "model-d" }, { provider: "other", id: "x" }], calls), cached, ["fixture/model-d"])
    expect(out.has("fixture/model-d")).toBe(true)
    expect(out.has("other/x")).toBe(false)
    expect(calls.n).toBe(1)
  })

  test("a model the live catalog also lacks stays missing (fallback still applies)", async () => {
    const calls = { n: 0 }
    const out = await confirmRequestedModels(client([{ provider: "fixture", id: "model-a" }], calls), cached, ["fixture/model-z"])
    expect(out.has("fixture/model-z")).toBe(false)
    expect(calls.n).toBe(1)
  })

  test("no live read when the requested model is cached, absent, or on a provider the cache does not serve", async () => {
    const calls = { n: 0 }
    const live = client([{ provider: "fixture", id: "model-d" }], calls)
    expect(await confirmRequestedModels(live, cached, ["fixture/model-b"])).toBe(cached)
    expect(await confirmRequestedModels(live, cached, [undefined])).toBe(cached)
    expect(await confirmRequestedModels(live, cached, ["elsewhere/model-d"])).toBe(cached)
    expect(calls.n).toBe(0)
  })

  test("a failing live read keeps the cached catalog", async () => {
    const failing = { model: { list: async () => { throw new Error("offline") } } } as never
    expect(await confirmRequestedModels(failing, cached, ["fixture/model-d"])).toBe(cached)
  })
})
