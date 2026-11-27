import { describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, relative, win32 } from "node:path"
import { fileURLToPath } from "node:url"
import { buildRemoteSdk, indexedFiles, staleArtifacts } from "./build-remote-sdk"

const root = fileURLToPath(new URL("..", import.meta.url))
const lib = join(root, "packages/omo-native/bin/lib")

// A script outside the repo: omo-ai installed in node_modules with only what the package ships for ./remote.
// Each @ts-expect-error must be a real error and nothing else may fail, with the shipped declarations checked
// (skipLibCheck off): an `any` leak or a declaration that does not resolve makes tsgo exit non-zero.
const PROBE = `import { handleOf, openRemote, REMOTE_CODES, type Remote, type RemoteFailure } from "omo-ai/remote"
const remote: Remote = openRemote({ stateDir: "/nonexistent" })
// @ts-expect-error not a member of the client
remote.definitelyNotAMember()
// @ts-expect-error a handle takes a device and a session, both strings
handleOf(1, 2)
// @ts-expect-error openRemote returns a client, not a number
const notANumber: number = openRemote()
const devices = await remote.devices.list()
if (devices.kind === "ok") {
  const name: string = devices.value[0]?.name ?? ""
  console.log(name, notANumber)
} else {
  const failure: RemoteFailure = devices
  const known: boolean = REMOTE_CODES.includes(failure.code)
  console.log(known, failure.next_action)
}
remote.close()
`

const consumerTypecheck = (moduleResolution: "nodenext" | "bundler") => {
  const dir = mkdtempSync(join(tmpdir(), "omo-remote-sdk-consumer-"))
  try {
    const pkg = join(dir, "node_modules/omo-ai")
    mkdirSync(join(pkg, "bin/lib"), { recursive: true })
    cpSync(join(lib, "remote-sdk-types"), join(pkg, "bin/lib/remote-sdk-types"), { recursive: true })
    for (const file of ["remote-sdk.generated.js", "remote-sdk.generated.d.ts"])
      cpSync(join(lib, file), join(pkg, "bin/lib", file))
    cpSync(join(root, "packages/omo-native/package.json"), join(pkg, "package.json"))
    symlinkSync(join(root, "node_modules/@types"), join(dir, "node_modules/@types"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(dir, "probe.ts"), PROBE)
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: moduleResolution === "nodenext" ? "nodenext" : "esnext",
          moduleResolution,
          target: "esnext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
        },
        files: ["probe.ts"],
      }),
    )
    const run = Bun.spawnSync([join(root, "node_modules/.bin/tsgo"), "-p", join(dir, "tsconfig.json")], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    return { code: run.exitCode, output: `${run.stdout.toString()}${run.stderr.toString()}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("omo-ai/remote build", () => {
  test("the bundle and its declarations match their source", async () => {
    await buildRemoteSdk(true)
  })

  // --check judges what a commit ships, git's index, never the working tree (#15186): a car checkout without the
  // generated outputs reports them stale instead of crashing, and an install's prepare build that rewrote the tree
  // cannot make stale committed bytes look current.
  // Every key is built with the platform's path module (backslashes on Windows), so the comparison runs with both.
  const BUILT = { "types/a.d.ts": "export {}\n", "bundle.js": "new" } as const
  const ROWS = [
    ["current", BUILT, []],
    ["nothing indexed (a car without the outputs)", {}, ["types/a.d.ts", "bundle.js"]],
    ["an artifact indexed with other bytes", { ...BUILT, "bundle.js": "old" }, ["bundle.js"]],
    ["a declaration built but never added", { "bundle.js": "new" }, ["types/a.d.ts"]],
    ["an indexed declaration the build no longer emits", { ...BUILT, "types/gone.d.ts": "" }, ["types/gone.d.ts"]],
    ["a sibling folder whose name starts with the types folder's", { ...BUILT, "types-old/b.d.ts": "" }, []],
  ] as const
  const PLATFORMS = [
    ["posix", posix, "/repo"],
    ["win32", win32, "C:\\repo"],
  ] as const
  test.each(
    PLATFORMS.flatMap(([platform, paths, base]) => ROWS.map((row) => [platform, ...row, paths, base] as const)),
  )("#given %s paths and %s #when compared #then the stale paths are listed", (_, __, index, expected, paths, base) => {
    const at = (path: string) => paths.join(base, path)
    const artifacts = new Map(Object.entries(BUILT).map(([path, text]) => [at(path), text]))
    const indexed = new Map(Object.entries(index).map(([path, text]) => [at(path), text]))
    const stale = staleArtifacts(artifacts, at("types"), indexed, paths)
    expect(stale.map((path) => paths.relative(base, path).split(paths.sep).join("/"))).toEqual([...expected])
  })

  test("#given stale bytes committed and fresh bytes rebuilt but not committed #when the index is read #then the output is stale", async () => {
    const repo = mkdtempSync(join(tmpdir(), "omo-remote-sdk-index-"))
    try {
      const run = (...args: string[]) => {
        const done = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
        expect(done.exitCode).toBe(0)
      }
      run("init", "-q")
      mkdirSync(join(repo, "lib/types"), { recursive: true })
      writeFileSync(join(repo, "lib/types/a.d.ts"), "export {} // stale\n")
      run("add", "-A")
      run("commit", "-q", "-m", "stale")
      writeFileSync(join(repo, "lib/types/a.d.ts"), "export {}\n")
      const artifacts = new Map([[join(repo, "lib/types/a.d.ts"), "export {}\n"]])
      const indexed = await indexedFiles(repo, join(repo, "lib"))
      expect(staleArtifacts(artifacts, join(repo, "lib/types"), indexed).map((path) => relative(repo, path))).toEqual([
        "lib/types/a.d.ts",
      ])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  for (const moduleResolution of ["nodenext", "bundler"] as const)
    test(`#given omo-ai installed in a bare project #when its ${moduleResolution} consumer type-checks with skipLibCheck off #then the shipped declarations resolve and type the API`, () => {
      expect(consumerTypecheck(moduleResolution)).toEqual({ code: 0, output: "" })
    })
})
