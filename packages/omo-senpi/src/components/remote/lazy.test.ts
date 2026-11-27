import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

// Architecture contract (guard S3, #13414 U5): omo.js loads the thread tools eagerly and imports the lazy surface from
// remote/lazy.ts, so that entry's static graph must never reach the client or its factories (they would land in omo.js).
describe("remote/lazy.ts", () => {
  test("#given the lazy entry #when it is bundled #then no client, factory or port runtime is in its graph", async () => {
    const entry = fileURLToPath(new URL("./lazy.ts", import.meta.url))
    const built = await Bun.build({ entrypoints: [entry], target: "bun", metafile: true, packages: "external" })
    expect(built.success).toBe(true)
    const inputs = Object.keys(built.metafile?.inputs ?? {}).map((path) => path.replace(/^.*components\/remote\//, ""))
    expect(inputs.sort()).toEqual(["lazy.ts", "port/lazy-remote.ts"])
  })
})
