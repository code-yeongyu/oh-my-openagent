import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compiledUpdate, readInstallRecord, releaseAssetName, type ReplaceBinary, updateDestination } from "../compiled-update"
import { removeTree } from "../../../test-support/remove-tree"

const root = mkdtempSync(join(tmpdir(), "omo-update-destination-"))
const runtimeRoot = join(root, "home", ".omo", "binary-runtime")
const runtimeCopy = join(runtimeRoot, "5.1.57", "omo")
const installed = join(root, "home", ".local", "bin", "omo")
const otherInstall = join(root, "opt", "omo")
for (const file of [runtimeCopy, installed, otherInstall]) {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, "#!/bin/sh\n")
}
const standalone = (binPath: string) => ({ method: "standalone", binPath })

afterAll(() => removeTree(root))

describe("compiled omo update destination (#12168)", () => {
  test("#given the update runs in the runtime copy a launcher handed off to #then it targets the launcher, not the runtime copy", () => {
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, launcher: installed })).toBe(installed)
  })

  test("#given a runtime copy with no launcher #then it targets the standalone installer's recorded binPath", () => {
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, installRecord: standalone(installed) })).toBe(installed)
  })

  test("#given both a launcher and a recorded binPath #then the binary the user actually launched wins", () => {
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, launcher: otherInstall, installRecord: standalone(installed) }))
      .toBe(otherInstall)
  })

  test("#given a launcher inside the runtime root, a non-standalone record and a missing binPath #then none is used", () => {
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, launcher: join(runtimeRoot, "5.1.56", "omo") })).toBe(runtimeCopy)
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, installRecord: { method: "npm", binPath: installed } })).toBe(runtimeCopy)
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, installRecord: standalone(join(root, "gone", "omo")) })).toBe(runtimeCopy)
    expect(updateDestination({ runningExecutable: runtimeCopy, runtimeRoot, installRecord: standalone("relative/omo") })).toBe(runtimeCopy)
  })

  test("#given a binary outside the runtime root ran the update itself #then it replaces itself as before", () => {
    expect(updateDestination({ runningExecutable: installed, runtimeRoot, launcher: otherInstall, installRecord: standalone(otherInstall) })).toBe(installed)
  })

  test("#given install.json #then a parsed object is read and a missing or malformed file reads as nothing", () => {
    const good = join(root, "install.json")
    writeFileSync(good, JSON.stringify(standalone(installed)))
    const bad = join(root, "bad-install.json")
    writeFileSync(bad, "{ not json")
    expect(readInstallRecord(good)).toEqual(standalone(installed))
    expect(readInstallRecord(bad)).toBeUndefined()
    expect(readInstallRecord(join(root, "absent.json"))).toBeUndefined()
  })
})

describe("compiled omo update refuses to write omo's runtime copy (#12168)", () => {
  const asset = releaseAssetName(undefined, "darwin", "arm64")
  async function update(destination: string, args: string[]) {
    let lookups = 0
    const installs: Parameters<ReplaceBinary>[] = []
    const result = await compiledUpdate({
      omoAiVersion: "5.1.57",
      releaseTarget: "darwin-arm64",
      destination,
      runtimeRoot,
      platform: "darwin",
      arch: "arm64",
      fetchReleases: async () => {
        lookups += 1
        return [{ tag_name: "v5.1.58", assets: [{ name: asset }] }]
      },
      args,
      replaceBinary: async (...call) => { installs.push(call) },
    })
    return { result, lookups, installs }
  }

  for (const args of [["update"], ["update", "--dry-run"]]) {
    test(`#given no installed binary could be resolved #when ${args.join(" ")} runs #then it refuses on stderr, installs nothing and prints no command for the runtime copy`, async () => {
      const { result, lookups, installs } = await update(runtimeCopy, args)
      expect(result.exitCode).toBe(1)
      expect(result.stream).toBe("stderr")
      expect(result.output).toContain("runtime copy")
      expect(result.output).toContain("omo update")
      expect(result.output).not.toContain("curl")
      expect(installs).toHaveLength(0)
      expect(lookups).toBe(0)
    })
  }

  test("#given the resolved installed binary #when update runs #then it installs there", async () => {
    const { result, installs } = await update(installed, ["update"])
    expect(result.exitCode).toBe(0)
    expect(installs.map((call) => call[1])).toEqual([installed])
  })
})
