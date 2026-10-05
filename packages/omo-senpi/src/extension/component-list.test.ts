/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createOmoSenpiComponents } from "./component-list"
import type { OmoSenpiComponent } from "./types"

const taskComponent: OmoSenpiComponent = {
  name: "task",
  register() {
    // The registration array is the unit under test; the injected task component stays inert.
  },
}

describe("createOmoSenpiComponents", () => {
  test("#given the production registration array #when x-search is looked up #then it is present exactly once", () => {
    // given
    const names = createOmoSenpiComponents(taskComponent).map(({ name }) => name)

    // when
    const occurrences = names.filter((name) => name === "x-search")

    // then
    expect(occurrences).toEqual(["x-search"])
  })

  test("#given the production registration array #when builtin-mcps is looked up #then it registers exactly once right after ast-grep", () => {
    // given
    const names = createOmoSenpiComponents(taskComponent).map(({ name }) => name)

    // when
    const occurrences = names.filter((name) => name === "builtin-mcps")

    // then
    expect(occurrences).toEqual(["builtin-mcps"])
    expect(names.indexOf("builtin-mcps")).toBe(names.indexOf("ast-grep") + 1)
  })

  test("#given the production registration array #when model-profile is looked up #then it registers exactly once right after config-startup", () => {
    // given
    const names = createOmoSenpiComponents(taskComponent).map(({ name }) => name)

    // when
    const occurrences = names.filter((name) => name === "model-profile")

    // then
    expect(occurrences).toEqual(["model-profile"])
    expect(names.indexOf("model-profile")).toBe(names.indexOf("config-startup") + 1)
  })

  test("#given the production registration array #when ordering is inspected #then x-search registers after lsp and before task tool capture", () => {
    // given
    const names = createOmoSenpiComponents(taskComponent).map(({ name }) => name)

    // when
    const lspIndex = names.indexOf("lsp")
    const xSearchIndex = names.indexOf("x-search")
    const taskIndex = names.indexOf("task")

    // then
    expect(xSearchIndex).toBe(lspIndex + 1)
    expect(xSearchIndex).toBeLessThan(taskIndex)
  })
})
