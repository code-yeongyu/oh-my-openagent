import { expect, test } from "bun:test"
import { isPriorityAliasOf } from "./pinned-model-equivalence"

test("a shared upstream ID only pairs priority siblings on the same API", () => {
  // given
  const base = { provider: "synthetic", id: "luna", api: "openai-codex-responses", upstreamModelId: "wire-luna" }
  const alias = { ...base, id: "luna-fast", serviceTier: "priority" }

  // when / then
  expect(isPriorityAliasOf(alias, base)).toBe(true)
  expect(isPriorityAliasOf({ ...alias, api: "openai-completions" }, base)).toBe(false)
})
