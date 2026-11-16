import { expect, test } from "bun:test"

import { engineAcceptsSpawnedBy, SPAWNED_BY_MIN_ENGINE_VERSION } from "./engine-spawned-by"

test.each([
  [SPAWNED_BY_MIN_ENGINE_VERSION, true],
  ["2026.10.24-3", false],
  ["2026.10.25-1", true],
  ["2026.10.100-1", true],
  ["2026.9.30-99", false],
  ["2026.11.1-1", true],
  ["2027.1.1-1", true],
  ["2026.10.24", false],
  ["2026.10.24-4+1758000000.abc1234", true],
  ["2026.9.18+1758000000.abc1234", false],
  ["dev-build", false],
  ["", false],
  [undefined, false],
] as const)("engine %p accepts spawned-by: %p", (version, accepts) => {
  // given a reported engine version; when it is compared field by field; then only the minimum and later accept
  expect(engineAcceptsSpawnedBy(version)).toBe(accepts)
})
