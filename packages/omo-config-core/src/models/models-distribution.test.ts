import { expect, test } from "bun:test"
import { createModelDistributor } from "./models-distribution"

test("default and sequential do not consume turns or mutate the configured chain", () => {
  const distribute = createModelDistributor()
  const entries = ["provider/a", "provider/b", "provider/c"]
  expect(distribute("category:one", entries)).toBe(entries)
  expect(distribute("category:one", entries, "sequential")).toBe(entries)
  expect(distribute("category:one", entries, "round_robin")).toEqual(entries)
  expect(distribute("category:one", entries, "round_robin")).toEqual([
    "provider/b", "provider/c", "provider/a",
  ])
  expect(entries).toEqual(["provider/a", "provider/b", "provider/c"])
})

test("cursors are per target and owner and wrap without duplicating models", () => {
  const distribute = createModelDistributor()
  const entries = ["provider/a", { model: "provider/b", reasoning: "high" }, "provider/a:low"]
  expect(distribute("category:one", entries, "round_robin")).toEqual(entries.slice(0, 2))
  expect(distribute("category:one", entries, "round_robin")).toEqual([entries[1], entries[0]])
  expect(distribute("agent:one", entries, "round_robin")).toEqual(entries.slice(0, 2))
  expect(distribute("category:two", entries, "round_robin")).toEqual(entries.slice(0, 2))
  expect(createModelDistributor()("category:one", entries, "round_robin")).toEqual(entries.slice(0, 2))
  expect(distribute("category:one", entries, "round_robin")).toEqual(entries.slice(0, 2))
  expect(distribute("empty", [], "round_robin")).toEqual([])
  expect(distribute("single", ["provider/a"], "round_robin")).toEqual(["provider/a"])
})
