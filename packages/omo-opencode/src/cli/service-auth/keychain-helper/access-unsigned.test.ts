import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildKeychainHelper } from "../../../../../omo-native/keychain-helper/build"
import { resolveHelperAccess } from "./access"
import type { HelperSpawner } from "./client"
import { bundleCandidates, machineCandidates } from "./location"

// The gate for unsigned development copies (#11580 builds one for its parity leg and the dev omob builder): every such
// copy, wherever it sits, fails the real designated-requirement check and is never spawned.
describe.skipIf(process.platform !== "darwin")("unsigned and ad-hoc helper copies are never run (#11262 design 1, addendum row 10)", () => {
  let dir: string
  let flavors: Record<"linker-adhoc" | "adhoc-with-identifier" | "unsigned", string>

  const codesign = async (...args: string[]) => {
    const child = Bun.spawn(["/usr/bin/codesign", ...args], { stdout: "ignore", stderr: "pipe", env: {} })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(`codesign ${args.join(" ")}: ${stderr}`)
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "helper-unsigned-"))
    const built = join(dir, "omo-keychain-built")
    await buildKeychainHelper({ output: built, flavor: "release", architectures: [process.arch === "arm64" ? "arm64" : "x86_64"] })
    flavors = {
      "linker-adhoc": built,
      "adhoc-with-identifier": join(dir, "omo-keychain-adhoc"),
      unsigned: join(dir, "omo-keychain-unsigned"),
    }
    copyFileSync(built, flavors["adhoc-with-identifier"])
    await codesign("--force", "--sign", "-", "--identifier", "com.mengmota.omo-keychain-helper", "--options", "runtime", flavors["adhoc-with-identifier"])
    copyFileSync(built, flavors.unsigned)
    await codesign("--remove-signature", flavors.unsigned)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const layout = (flavor: string) => {
    const root = join(dir, `layout-${Math.random().toString(16).slice(2)}`)
    const bundleFile = `file://${join(root, "pkg", "bin", "lib", "service-auth.generated.js")}`
    const paths = [...bundleCandidates(bundleFile), ...machineCandidates(join(root, "home"), process.arch).map(path => join(root, "machine", path))]
    for (const path of paths) {
      mkdirSync(join(path, ".."), { recursive: true })
      copyFileSync(flavor, path)
    }
    return paths
  }

  test.each(["linker-adhoc", "adhoc-with-identifier", "unsigned"] as const)(
    "#given a %s helper at every candidate path #when the store resolves its helper #then each is refused by the real check and nothing is spawned",
    async flavor => {
      const paths = layout(flavors[flavor])
      let spawned = 0
      const spawn: HelperSpawner = () => {
        spawned++
        throw new Error("an unverified helper must never be spawned")
      }
      const access = await resolveHelperAccess(paths, { spawn })
      expect(access).toEqual({ kind: "invalid", rejected: paths })
      expect(spawned).toBe(0)
    },
  )
})
