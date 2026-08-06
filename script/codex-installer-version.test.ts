/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const rootPackagePath = new URL("../package.json", import.meta.url)
const codexPackagePath = new URL("../packages/omo-codex/package.json", import.meta.url)
const installerPath = new URL("../packages/omo-codex/scripts/install-dist/install-local.mjs", import.meta.url)

test("#given the generated Codex installer #when release versions are synchronized #then its embedded package version matches the root release version", () => {
  // given
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8")) as { version: string }
  const codexPackage = JSON.parse(readFileSync(codexPackagePath, "utf8")) as { version: string }
  const installer = readFileSync(installerPath, "utf8")

  // then
  expect(codexPackage.version).toBe(rootPackage.version)
  expect(installer).toContain(`version: "${rootPackage.version}"`)
})
