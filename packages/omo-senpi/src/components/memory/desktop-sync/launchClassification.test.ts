import { expect, test } from "bun:test"
import { join } from "node:path"

// omo.js's registration half imports launchClassification.ts before any sidecar loads, so the module must stay a
// leaf: an import of the sidecar, senpi private-fds or anything else would pull that code into omo.js.
test("#given the launch classification module #when it is bundled alone #then nothing but the module itself is an input", async () => {
  const entry = join(import.meta.dirname, "launchClassification.ts")
  const built = await Bun.build({ entrypoints: [entry], target: "bun", metafile: true, packages: "external" })
  expect(built.success).toBe(true)
  const inputs = Object.keys(built.metafile?.inputs ?? {})
  expect(inputs).toHaveLength(1)
  const imports = Object.values(built.metafile?.inputs ?? {}).flatMap(input => input.imports.map(i => i.path))
  expect(imports).toEqual([])
})
