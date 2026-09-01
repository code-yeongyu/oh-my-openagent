import { describe, expect, test } from "bun:test"

import { renderMemoryBindingEntry } from "./entry-renderer"

describe("renderMemoryBindingEntry", () => {
  test("#given a persisted identity binding #when the TUI asks to render it #then it stays hidden and cannot produce model text", () => {
    expect(renderMemoryBindingEntry()).toBeUndefined()
  })
})
