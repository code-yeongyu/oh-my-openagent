import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

// Architecture contract (guard S3, #13414): admin.ts is the module's heavy entry (install, bootstrap, cold wake, the
// operator endpoint leg). The light entries must never reach it, or omo.js and `omo remote`'s local-only graph would
// carry the installer's network code and the endpoint's sockets.
const inputsOf = async (entry: string): Promise<string[]> => {
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL(entry, import.meta.url))],
    target: "bun",
    metafile: true,
    packages: "external",
  })
  expect(built.success).toBe(true)
  return Object.keys(built.metafile?.inputs ?? {}).map((path) => path.replaceAll("\\", "/"))
}

describe("remote/admin.ts", () => {
  for (const entry of ["./index.ts", "./lazy.ts"])
    test(`#given ${entry} #when it is bundled #then its graph never reaches admin.ts, the installer or the operator endpoint`, async () => {
      const reached = (await inputsOf(entry)).filter(
        (path) =>
          path.endsWith("/components/remote/admin.ts") ||
          path.endsWith("/components/remote/local-sessions.ts") ||
          path.endsWith("/device-service-core/src/install.ts") ||
          path.endsWith("/device-service-core/src/index.ts"),
      )
      expect(reached).toEqual([])
    })
})
