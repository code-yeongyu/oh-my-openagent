import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"

const packageDir = join(import.meta.dir, "..")
const tsgo = join(dirname(Bun.resolveSync("@typescript/native-preview/package.json", packageDir)), "bin", "tsgo")

describe("the root types entry declares every diagnostic the runtime emits", () => {
  test("#given a consumer importing @oh-my-opencode/telemetry-core #when it narrows to the spool purge diagnostics and reads errorCode and entryKind #then it type-checks against the root index.d.ts", () => {
    // given
    const project = join(packageDir, "test-fixtures", "root-types", "tsconfig.json")

    // when
    const result = Bun.spawnSync([process.execPath, tsgo, "--noEmit", "-p", project], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })

    // then
    expect({ exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` }).toEqual({ exitCode: 0, output: "" })
  }, 60_000)
})
