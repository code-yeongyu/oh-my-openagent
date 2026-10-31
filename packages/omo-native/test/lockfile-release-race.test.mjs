import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { prepareLockfileReleaseRace } from "../bin/lib/lockfile-release-race.js"
import { prepareInstalledEngine } from "../bin/lib/engine-prepare.js"

const require = createRequire(import.meta.resolve("@code-yeongyu/senpi"))
const upstream = readFileSync(require.resolve("proper-lockfile/lib/lockfile.js"), "utf8")
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-lock-release-"))
  roots.push(root)
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const library = join(root, "node_modules/proper-lockfile/lib/lockfile.js")
  const cli = join(root, "dist/bundle/chunks/renamed-cli-chunk.js")
  const worker = join(root, "dist/bundle/chunks/session-worker.js")
  for (const path of [library, cli, worker]) {
    mkdirSync(dirname(path), { recursive: true })
    // The bundle renames locals and removes callback whitespace.
    const source = path === library ? upstream : upstream
      .replace(/\block\b/g, "lock2").replace(/\berr\b/g, "err3").replace(/\bstat\b/g, "stat34")
      .replace("options.fs.stat34(lock2.lockfilePath, (err3, stat34) => {",
        "options.fs.stat(lock2.lockfilePath,(err3,stat34)=>{")
    writeFileSync(path, source)
  }
  return { root, paths: [library, cli, worker] }
}

// Execute the dependency's real update/compromise/unlock functions. Control only
// their timer and filesystem boundary, so the race has a fixed event ordering.
function pendingHeartbeat(source) {
  const update = source.slice(source.indexOf("function updateLock("), source.search(/function lock\d*\(/))
  const unlock = source.slice(source.indexOf("function unlock("), source.indexOf("function check("))
  let timer
  let stat
  let touches = 0
  const fs = {
    stat: (_path, callback) => { stat = callback },
    utimes: (_path, _atime, _mtime, callback) => { touches++; callback() },
  }
  const options = { fs, stale: 30000, update: 15000, realpath: false, onCompromised: (error) => { throw error } }
  const lock = { lockfilePath: "/isolated/cache.lock", options, lastUpdate: Date.now(), mtime: new Date(1000) }
  const locks = { "/isolated/cache": lock }
  const api = new Function("locks", "fs", "setTimeout", "clearTimeout", "mtimePrecision", "resolveCanonicalPath", "removeLock",
    `${update}\n${unlock}\nreturn {updateLock,unlock};`)(
    locks, fs, (callback) => { timer = callback; return { unref() {} } }, () => {},
    { getMtime: () => new Date(1000) }, (file, _options, callback) => callback(null, file),
    (_file, _options, callback) => callback(),
  )
  api.updateLock("/isolated/cache", options)
  timer()
  return {
    locks,
    release: () => api.unlock("/isolated/cache", options, (error) => { if (error) throw error }),
    finish: (error, result) => stat(error, result),
    touches: () => touches,
  }
}

test("the unprepared dependency reproduces the late ENOENT crash", () => {
  const h = pendingHeartbeat(upstream)
  h.release()
  expect(() => h.finish(Object.assign(new Error("missing lock"), { code: "ENOENT" }))).toThrow("missing lock")
})

for (const outcome of ["ENOENT", "changed mtime", "matching mtime"]) {
  test(`prepared library and bundles ignore ${outcome} after release without touching a new owner`, () => {
    const f = fixture()
    prepareLockfileReleaseRace(f.root)
    for (const path of f.paths) {
      const h = pendingHeartbeat(readFileSync(path, "utf8"))
      h.release()
      const owner = { released: false }
      h.locks["/isolated/cache"] = owner
      const error = outcome === "ENOENT" ? Object.assign(new Error("missing lock"), { code: "ENOENT" }) : null
      expect(() => h.finish(error, { mtime: new Date(outcome === "matching mtime" ? 1000 : 2000) })).not.toThrow()
      expect(h.locks["/isolated/cache"]).toBe(owner)
      expect(owner.released).toBe(false)
      expect(h.touches()).toBe(0)
    }
  })
}

test("preparation preserves compromise detection for an owned lock", () => {
  const f = fixture()
  prepareLockfileReleaseRace(f.root)
  for (const path of f.paths) {
    const h = pendingHeartbeat(readFileSync(path, "utf8"))
    const error = Object.assign(new Error("missing owned lock"), { code: "ENOENT" })
    expect(() => h.finish(error)).toThrow("missing owned lock")
    expect(error.code).toBe("ECOMPROMISED")
  }
})

test("repeated preparation is byte-identical", () => {
  const f = fixture()
  prepareLockfileReleaseRace(f.root)
  const first = f.paths.map((path) => readFileSync(path, "utf8"))
  prepareLockfileReleaseRace(f.root)
  expect(f.paths.map((path) => readFileSync(path, "utf8"))).toEqual(first)
})

test("the postinstall and first-launch preparation path installs the guard", () => {
  const f = fixture()
  const ua = join(f.root, "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js")
  const rpc = join(f.root, "dist/modes/rpc/rpc-mode.js")
  mkdirSync(dirname(ua), { recursive: true })
  mkdirSync(dirname(rpc), { recursive: true })
  writeFileSync(ua, 'const claudeCodeVersion = "2.1.280";\n')
  writeFileSync(rpc, readFileSync(new URL("./modes/rpc/rpc-mode.js", import.meta.resolve("@code-yeongyu/senpi")), "utf8"))
  for (const path of f.paths.slice(1)) {
    writeFileSync(path, 'const claudeCodeVersion="2.1.280";\n' + readFileSync(path, "utf8"))
  }
  prepareInstalledEngine(f.root)
  for (const path of f.paths) {
    const h = pendingHeartbeat(readFileSync(path, "utf8"))
    h.release()
    expect(() => h.finish(Object.assign(new Error("missing lock"), { code: "ENOENT" }))).not.toThrow()
  }
})
