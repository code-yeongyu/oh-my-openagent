/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const rootPackagePath = new URL("../package.json", import.meta.url)
const codexPackagePath = new URL("../packages/omo-codex/package.json", import.meta.url)
// The installer reads its version at runtime from the plugin manifest it ships beside (#14867).
const pluginPackagePath = new URL("../packages/omo-codex/plugin/package.json", import.meta.url)

test("#given the Codex installer's runtime version source #when release versions are synchronized #then both Codex manifests match the root release version", () => {
  // given
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8")) as { version: string }
  const codexPackage = JSON.parse(readFileSync(codexPackagePath, "utf8")) as { version: string }
  const pluginPackage = JSON.parse(readFileSync(pluginPackagePath, "utf8")) as { version: string }

  // then
  expect(codexPackage.version).toBe(rootPackage.version)
  expect(pluginPackage.version).toBe(rootPackage.version)
})
