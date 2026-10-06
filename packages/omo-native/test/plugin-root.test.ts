import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, sep } from "node:path"
import { resolvePluginRoot } from "../bin/lib/plugin-root.js"
import { createPluginRootSelection } from "../bin/lib/plugin-root-selection.js"
import { runDoctor } from "../bin/lib/doctor.js"

const SPEC = "daemon-launch-spec.json"
const roots: string[] = []
const posixOnly = test.skipIf(process.platform === "win32")

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pluginFixture(withSpec = true) {
  const fixtureRoot = mkdtempSync(join(realpathSync(tmpdir()), "omo-plugin-root-"))
  roots.push(fixtureRoot)
  const pluginRoot = join(fixtureRoot, "plugin")
  const cacheRoot = join(fixtureRoot, "cache")
  mkdirSync(join(pluginRoot, "extensions"), { recursive: true })
  mkdirSync(join(pluginRoot, "runtime", "thread-sdk"), { recursive: true })
  writeFileSync(join(pluginRoot, "package.json"), '{"pi":{"extensions":["./extensions/member.js"]}}\n')
  writeFileSync(join(pluginRoot, "extensions", "member.js"), "export const member = true\n")
  writeFileSync(join(pluginRoot, "runtime", "thread-sdk", "sdk.js"), "export const sdk = true\n")
  chmodSync(join(pluginRoot, "extensions", "member.js"), 0o744)
  chmodSync(join(pluginRoot, "runtime", "thread-sdk", "sdk.js"), 0o644)
  chmodSync(join(pluginRoot, "package.json"), 0o644)
  if (withSpec) writeFileSync(join(pluginRoot, SPEC), '{"spec_version":1}\n')
  return { fixtureRoot, pluginRoot, cacheRoot, specPath: join(pluginRoot, SPEC) }
}

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

function rootOwnedIo(pluginRoot: string, cacheRoot: string, ownerForPath: (path: string) => number | undefined = () => undefined) {
  const actualUid = process.getuid?.() ?? 0
  const uid = actualUid === 0 ? 1001 : actualUid
  return {
    uid,
    io: {
      getuid: () => uid,
      lstat(path: string) {
        const stat = lstatSync(path)
        const physicalPath = realpathSync(path)
        const owner = ownerForPath(path)
          ?? (within(pluginRoot, physicalPath) ? 0 : within(cacheRoot, physicalPath) ? uid : stat.uid)
        return new Proxy(stat, {
          get(target, property) {
            if (property === "uid") return owner
            const value = Reflect.get(target, property, target)
            return typeof value === "function" ? value.bind(target) : value
          },
        })
      },
    },
  }
}

function modeOf(path: string): number {
  return lstatSync(path).mode & 0o7777
}

function cacheDirectoryRace(io: ReturnType<typeof rootOwnedIo>["io"], cacheRoot: string) {
  let firstLookup = true
  return {
    ...io,
    lstat(path: string) {
      if (path === cacheRoot && firstLookup) {
        firstLookup = false
        throw Object.assign(new Error("cache directory was absent at inspection"), { code: "ENOENT" })
      }
      return io.lstat(path)
    },
  }
}

describe("Native plugin root selection", () => {
  posixOnly("#given a secure root-owned plugin tree #when selected #then it returns a complete private user-owned copy without mutating the source", () => {
    const { pluginRoot, cacheRoot, specPath } = pluginFixture()
    const memberPath = join(pluginRoot, "extensions", "member.js")
    const { io, uid } = rootOwnedIo(pluginRoot, cacheRoot)

    const selected = resolvePluginRoot(pluginRoot, cacheRoot, io)

    expect(selected).not.toBe(pluginRoot)
    expect(readFileSync(join(selected, "package.json"), "utf8")).toBe(readFileSync(join(pluginRoot, "package.json"), "utf8"))
    expect(readFileSync(join(selected, SPEC), "utf8")).toBe(readFileSync(specPath, "utf8"))
    expect(readFileSync(join(selected, "extensions", "member.js"), "utf8")).toBe(readFileSync(memberPath, "utf8"))
    const sourceSdk = join(pluginRoot, "runtime", "thread-sdk", "sdk.js")
    expect(readFileSync(join(selected, "runtime", "thread-sdk", "sdk.js"), "utf8")).toBe(readFileSync(sourceSdk, "utf8"))
    expect(io.lstat(selected).uid).toBe(uid)
    expect(modeOf(selected)).toBe(0o700)
    expect(modeOf(join(selected, "runtime"))).toBe(0o700)
    expect(modeOf(join(selected, SPEC))).toBe(0o600)
    expect(modeOf(join(selected, "extensions", "member.js"))).toBe(0o700)
    expect(modeOf(specPath)).toBe(0o644)
    expect(readFileSync(memberPath, "utf8")).toBe("export const member = true\n")
  })

  posixOnly("#given a foreign non-root launch spec #when selected #then it fails instead of returning the foreign path", () => {
    const { pluginRoot, cacheRoot, specPath } = pluginFixture()
    const { io, uid } = rootOwnedIo(pluginRoot, cacheRoot, (path) => path === specPath ? uid + 1 : undefined)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given a root-owned payload with a group-writable file #when selected #then it is rejected", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    chmodSync(join(pluginRoot, "extensions", "member.js"), 0o664)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given a root-owned payload containing a symlink #when selected #then the symlink is not materialized", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    symlinkSync(join(pluginRoot, SPEC), join(pluginRoot, "extensions", "linked-spec.json"))
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given a foreign-owned nested payload file #when selected #then it is rejected", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const memberPath = join(pluginRoot, "extensions", "member.js")
    const { io, uid } = rootOwnedIo(pluginRoot, cacheRoot, (path) => path === memberPath ? uid + 1 : undefined)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given a group-writable source ancestor #when selected #then it is rejected before caching", () => {
    const { fixtureRoot, pluginRoot, cacheRoot } = pluginFixture()
    chmodSync(fixtureRoot, 0o770)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
    expect(existsSync(cacheRoot)).toBe(false)
  })

  posixOnly("#given a group-writable cache ancestor #when the launcher selects its plugin #then it keeps the shared install and doctor reports the refusal", () => {
    const { fixtureRoot, pluginRoot } = pluginFixture()
    const agentHome = join(fixtureRoot, ".omo")
    const cacheRoot = join(agentHome, "agent", "native-plugin")
    mkdirSync(join(agentHome, "agent"), { recursive: true })
    chmodSync(agentHome, 0o775)
    const warnings: string[] = []
    const { io, uid } = rootOwnedIo(pluginRoot, cacheRoot)
    const select = createPluginRootSelection(pluginRoot, cacheRoot, { ...io, warn: (line) => warnings.push(line) })

    const selection = select()
    const output: string[] = []
    const originalLog = console.log
    const originalExitCode = process.exitCode
    try {
      console.log = (value?: unknown) => { output.push(String(value)) }
      runDoctor({ harnesses: [] }, [], {
        pluginRoot: selection.root,
        pluginRelocationWarnings: selection.warning === undefined ? [] : [selection.warning],
        launchSpecIo: { getuid: () => uid, stat: () => io.lstat(join(pluginRoot, SPEC)) },
        list: () => [],
        fetchDistTags: () => null,
        daemonReport: () => [],
        env: { OMO_CODING_AGENT_DIR: join(agentHome, "agent") },
        homeDir: fixtureRoot,
      })
    } finally {
      console.log = originalLog
      process.exitCode = originalExitCode ?? 0
    }

    expect(selection.root).toBe(pluginRoot)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(`unsafe writable plugin path ancestor: ${agentHome}`)
    expect(output.join("\n")).toContain(warnings[0] ?? "")
    expect(output.join("\n")).toContain("launch_spec_insecure")
    expect(modeOf(agentHome)).toBe(0o775)
    expect(existsSync(cacheRoot)).toBe(false)
    expect(select()).toBe(selection)
    expect(warnings).toHaveLength(1)
  })

  posixOnly("#given a selected private plugin #when the source changes during this process #then repeated selection keeps the same root without another filesystem walk", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    let inspections = 0
    const select = createPluginRootSelection(pluginRoot, cacheRoot, {
      ...io,
      lstat(path: string) { inspections++; return io.lstat(path) },
    })
    const initial = select()
    const initialInspections = inspections
    writeFileSync(join(pluginRoot, "extensions", "member.js"), "export const member = false\n")

    const repeated = select()

    expect(repeated.root).toBe(initial.root)
    expect(inspections).toBe(initialInspections)
    expect(readFileSync(join(repeated.root, "extensions", "member.js"), "utf8")).toBe("export const member = true\n")
  })

  posixOnly("#given an existing relocated cache whose file was tampered #when selected again #then the cache is rejected", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const selected = resolvePluginRoot(pluginRoot, cacheRoot, io)
    writeFileSync(join(selected, "extensions", "member.js"), "export const member = false\n")

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given an existing relocated cache with a missing payload file #when selected again #then the incomplete cache is rejected", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const selected = resolvePluginRoot(pluginRoot, cacheRoot, io)
    rmSync(join(selected, "runtime", "thread-sdk", "sdk.js"))

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
  })

  posixOnly("#given a cache root symlink to a writable directory #when selected #then its unsafe target is rejected", () => {
    const { fixtureRoot, pluginRoot, cacheRoot } = pluginFixture()
    const target = join(fixtureRoot, "cache-target")
    mkdirSync(target)
    chmodSync(target, 0o770)
    symlinkSync(target, cacheRoot)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, io)).toThrow()
    expect(modeOf(target)).toBe(0o770)
  })

  posixOnly("#given trusted source and cache directory aliases #when selected #then it validates and uses their physical paths", () => {
    const { fixtureRoot, pluginRoot, cacheRoot } = pluginFixture()
    mkdirSync(cacheRoot, { mode: 0o700 })
    const pluginAlias = join(fixtureRoot, "plugin-alias")
    const cacheAlias = join(fixtureRoot, "cache-alias")
    symlinkSync(pluginRoot, pluginAlias)
    symlinkSync(cacheRoot, cacheAlias)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    const selected = resolvePluginRoot(pluginAlias, cacheAlias, io)

    expect(selected.startsWith(`${cacheRoot}${sep}`)).toBe(true)
    expect(readFileSync(join(selected, SPEC), "utf8")).toBe(readFileSync(join(pluginRoot, SPEC), "utf8"))
  })

  posixOnly("#given a missing cache below a symlinked agent directory #when selected #then it creates the cache under the trusted physical ancestor", () => {
    const { fixtureRoot, pluginRoot, cacheRoot } = pluginFixture()
    const agentAlias = join(fixtureRoot, "agent-alias")
    symlinkSync(fixtureRoot, agentAlias)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    const selected = resolvePluginRoot(pluginRoot, join(agentAlias, "cache"), io)

    expect(selected.startsWith(`${cacheRoot}${sep}`)).toBe(true)
    expect(modeOf(cacheRoot)).toBe(0o700)
  })

  posixOnly("#given a source alias to a writable ancestor #when selected #then the physical source is rejected before caching", () => {
    const { fixtureRoot, pluginRoot, cacheRoot } = pluginFixture()
    const pluginAlias = join(fixtureRoot, "plugin-alias")
    symlinkSync(pluginRoot, pluginAlias)
    chmodSync(fixtureRoot, 0o770)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginAlias, cacheRoot, io)).toThrow(`unsafe writable plugin path ancestor: ${fixtureRoot}`)
    expect(existsSync(cacheRoot)).toBe(false)
  })

  posixOnly("#given changed payload contents #when selected again #then it uses a new cache containing the new contents", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const sourcePath = join(pluginRoot, "extensions", "member.js")
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const initial = resolvePluginRoot(pluginRoot, cacheRoot, io)
    writeFileSync(sourcePath, "export const member = false\n")

    const updated = resolvePluginRoot(pluginRoot, cacheRoot, io)

    expect(updated).not.toBe(initial)
    expect(readFileSync(join(updated, "extensions", "member.js"), "utf8")).toBe("export const member = false\n")
  })

  posixOnly("#given two previous plugin versions #when a new copy is published #then it keeps the current and newest previous version", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const sourcePath = join(pluginRoot, "extensions", "member.js")
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const oldest = resolvePluginRoot(pluginRoot, cacheRoot, io)
    utimesSync(oldest, 1, 1)
    writeFileSync(sourcePath, "export const member = 2\n")
    const previous = resolvePluginRoot(pluginRoot, cacheRoot, io)
    utimesSync(previous, 2, 2)
    const staging = join(cacheRoot, ".plugin-root-active")
    const unrelated = join(cacheRoot, "operator-files")
    mkdirSync(staging)
    mkdirSync(unrelated)
    const linked = join(cacheRoot, "a".repeat(64))
    symlinkSync(unrelated, linked)
    writeFileSync(sourcePath, "export const member = 3\n")

    const current = resolvePluginRoot(pluginRoot, cacheRoot, io)

    expect(existsSync(oldest)).toBe(false)
    expect(readFileSync(join(previous, "extensions", "member.js"), "utf8")).toBe("export const member = 2\n")
    expect(readFileSync(join(current, "extensions", "member.js"), "utf8")).toBe("export const member = 3\n")
    expect(readdirSync(cacheRoot).sort()).toEqual([basename(previous), basename(current), ".plugin-root-active", "operator-files", "a".repeat(64)].sort())
    expect(lstatSync(linked).isSymbolicLink()).toBe(true)
  })

  posixOnly("#given foreign-owned or non-private fingerprint directories #when a copy is published #then pruning leaves them untouched", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const { io, uid } = rootOwnedIo(pluginRoot, cacheRoot)
    resolvePluginRoot(pluginRoot, cacheRoot, io)
    const foreign = join(cacheRoot, "b".repeat(64))
    const writable = join(cacheRoot, "c".repeat(64))
    mkdirSync(foreign, { mode: 0o700 })
    mkdirSync(writable, { mode: 0o700 })
    chmodSync(writable, 0o770)
    const protectedIo = rootOwnedIo(pluginRoot, cacheRoot, (path) => path === foreign ? uid + 1 : undefined).io
    writeFileSync(join(pluginRoot, "extensions", "member.js"), "export const member = 2\n")

    resolvePluginRoot(pluginRoot, cacheRoot, protectedIo)

    expect(existsSync(foreign)).toBe(true)
    expect(modeOf(writable)).toBe(0o770)
  })

  posixOnly("#given a changed source mode #when selected again #then it uses a different cache with private executable mode", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const sourcePath = join(pluginRoot, "extensions", "member.js")
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const initial = resolvePluginRoot(pluginRoot, cacheRoot, io)
    chmodSync(sourcePath, 0o644)

    const updated = resolvePluginRoot(pluginRoot, cacheRoot, io)

    expect(updated).not.toBe(initial)
    expect(modeOf(join(updated, "extensions", "member.js"))).toBe(0o600)
  })

  posixOnly("#given a changed relative payload path #when selected again #then it uses a different cache with the renamed file", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const oldPath = join(pluginRoot, "extensions", "member.js")
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const initial = resolvePluginRoot(pluginRoot, cacheRoot, io)
    const newPath = join(pluginRoot, "extensions", "renamed.js")
    renameSync(oldPath, newPath)

    const updated = resolvePluginRoot(pluginRoot, cacheRoot, io)

    expect(updated).not.toBe(initial)
    expect(existsSync(join(updated, "extensions", "renamed.js"))).toBe(true)
    expect(existsSync(join(updated, "extensions", "member.js"))).toBe(false)
  })

  posixOnly("#given another contender creates the private cache directory after inspection #when selected #then it validates the directory and relocates the payload", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    mkdirSync(cacheRoot, { mode: 0o700 })
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    const selected = resolvePluginRoot(pluginRoot, cacheRoot, cacheDirectoryRace(io, cacheRoot))

    expect(readFileSync(join(selected, SPEC), "utf8")).toBe(readFileSync(join(pluginRoot, SPEC), "utf8"))
  })

  posixOnly("#given a raced cache directory is group-writable #when selected #then it is rejected without changing its permissions", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    mkdirSync(cacheRoot)
    chmodSync(cacheRoot, 0o770)
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)

    expect(() => resolvePluginRoot(pluginRoot, cacheRoot, cacheDirectoryRace(io, cacheRoot))).toThrow()

    expect(modeOf(cacheRoot)).toBe(0o770)
  })

  posixOnly("#given another contender publishes the same complete cache first #when this contender publishes #then it validates and reuses the winner", () => {
    const { pluginRoot, cacheRoot } = pluginFixture()
    const { io } = rootOwnedIo(pluginRoot, cacheRoot)
    const competingIo = {
      ...io,
      rename(source: string, destination: string) {
        renameSync(source, destination)
        throw Object.assign(new Error("cache already published"), { code: "EEXIST" })
      },
    }

    const selected = resolvePluginRoot(pluginRoot, cacheRoot, competingIo)

    expect(selected.startsWith(`${cacheRoot}${sep}`)).toBe(true)
    const sourceSdk = join(pluginRoot, "runtime", "thread-sdk", "sdk.js")
    expect(readFileSync(join(selected, "runtime", "thread-sdk", "sdk.js"), "utf8")).toBe(readFileSync(sourceSdk, "utf8"))
  })

  posixOnly("#given a current-user-owned launch spec #when selected #then its original path and mode are untouched", () => {
    const { pluginRoot, cacheRoot, specPath } = pluginFixture()
    chmodSync(specPath, 0o664)

    const selected = resolvePluginRoot(pluginRoot, cacheRoot)

    expect(selected).toBe(pluginRoot)
    expect(modeOf(specPath)).toBe(0o664)
    expect(existsSync(cacheRoot)).toBe(false)
  })

  posixOnly("#given a plugin without a launch spec #when selected #then its original missing-artifact path is preserved", () => {
    const { pluginRoot, cacheRoot } = pluginFixture(false)

    expect(resolvePluginRoot(pluginRoot, cacheRoot)).toBe(pluginRoot)
    expect(existsSync(cacheRoot)).toBe(false)
  })

  test("#given win32 #when selected #then it returns the original path without filesystem access", () => {
    const calls: string[] = []
    const selected = resolvePluginRoot("/system/plugin", "/agent/native-plugin", {
      platform: "win32",
      getuid: () => { calls.push("getuid"); return 1001 },
      lstat: () => { calls.push("lstat"); throw new Error("must not inspect paths") },
    })

    expect(selected).toBe("/system/plugin")
    expect(calls).toEqual([])
  })
})
