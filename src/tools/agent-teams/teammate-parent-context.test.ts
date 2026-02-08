/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("agent-teams teammate parent context", () => {
  test("forwards incoming abort signal to parent context resolver", () => {
    //#given
    const sourceUrl = new URL("./teammate-parent-context.ts", import.meta.url)
    const source = readFileSync(sourceUrl, "utf-8")

    //#then
    expect(source.includes("abort: context.abort ?? new AbortController().signal")).toBe(true)
  })
})
