import { expect, test } from "bun:test"

import * as compatibility from "./collectors"
import { collectCore, collectExternal } from "./entry-collector"
import { collectHistory } from "./history-collector"
import { collectReflection } from "./reflection-collector"

test("collectors preserves the established palace collector exports", () => {
  expect(compatibility.collectCore).toBe(collectCore)
  expect(compatibility.collectExternal).toBe(collectExternal)
  expect(compatibility.collectHistory).toBe(collectHistory)
  expect(compatibility.collectReflection).toBe(collectReflection)
})
