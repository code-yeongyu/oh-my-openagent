import { describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildRemoteSdk } from "./build-remote-sdk"

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
  }, 120_000)

  for (const moduleResolution of ["nodenext", "bundler"] as const)
    test(`#given omo-ai installed in a bare project #when its ${moduleResolution} consumer type-checks with skipLibCheck off #then the shipped declarations resolve and type the API`, () => {
      expect(consumerTypecheck(moduleResolution)).toEqual({ code: 0, output: "" })
    }, 120_000)
})
