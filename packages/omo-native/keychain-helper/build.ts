import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

export const KEYCHAIN_HELPER_IDENTIFIER = "com.mengmota.omo-keychain-helper"
export const KEYCHAIN_HELPER_TEAM = "523JNR86LZ"
export const KEYCHAIN_HELPER_REQUIREMENT =
  `identifier "${KEYCHAIN_HELPER_IDENTIFIER}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] ` +
  `and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "${KEYCHAIN_HELPER_TEAM}"`

/** Q5, decided 2026-10-28 (fewest prompts): the helper serves root. The refuse-root branch stays buildable behind this switch. */
const KEYCHAIN_HELPER_REFUSE_ROOT_DEFAULT = false

const SOURCES = ["main.c", "buffer.c", "request.c", "store.c", "partition.c", "session.c", "verbs.c"] as const

export type KeychainHelperArchitecture = "arm64" | "x86_64"

export type KeychainHelperBuild = {
  readonly output: string
  /** `test` adds --keychain/--no-ui and the other test-only flags; a release binary takes no arguments. */
  readonly flavor: "release" | "test"
  readonly refuseRoot?: boolean
  readonly architectures?: readonly KeychainHelperArchitecture[]
}

export const UNIVERSAL: readonly KeychainHelperArchitecture[] = ["arm64", "x86_64"]

function keychainHelperCompileArgs(build: KeychainHelperBuild): string[] {
  const sourceDir = join(import.meta.dir, "src")
  const architectures = build.architectures ?? UNIVERSAL
  return [
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-mmacosx-version-min=12.0",
    ...architectures.flatMap(arch => ["-arch", arch]),
    ...(build.flavor === "test" ? ["-DOMO_KEYCHAIN_TEST_BUILD=1"] : []),
    `-DOMO_KEYCHAIN_REFUSE_ROOT=${(build.refuseRoot ?? KEYCHAIN_HELPER_REFUSE_ROOT_DEFAULT) ? 1 : 0}`,
    "-framework",
    "Security",
    "-framework",
    "CoreFoundation",
    "-o",
    build.output,
    ...SOURCES.map(source => join(sourceDir, source)),
  ]
}

export async function buildKeychainHelper(build: KeychainHelperBuild): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The keychain helper builds on macOS only.")
  await mkdir(dirname(build.output), { recursive: true })
  const compiler = Bun.spawn(["clang", ...keychainHelperCompileArgs(build)], { stdout: "pipe", stderr: "pipe" })
  const [stderr, exitCode] = await Promise.all([new Response(compiler.stderr).text(), compiler.exited])
  if (exitCode !== 0) throw new Error(`clang failed (${exitCode}) building the keychain helper:\n${stderr}`)
}

function parseCli(argv: readonly string[]): KeychainHelperBuild {
  let output: string | undefined
  let flavor: KeychainHelperBuild["flavor"] = "release"
  let refuseRoot: boolean | undefined
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === "--out") output = argv[++index]
    else if (flag === "--flavor") {
      const value = argv[++index]
      if (value !== "release" && value !== "test") throw new Error(`--flavor must be release or test, got ${value}`)
      flavor = value
    } else if (flag === "--refuse-root") refuseRoot = true
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (output === undefined) throw new Error("Usage: bun build.ts --out <path> [--flavor release|test] [--refuse-root]")
  return { output, flavor, ...(refuseRoot === undefined ? {} : { refuseRoot }) }
}

if (import.meta.main) await buildKeychainHelper(parseCli(process.argv.slice(2)))
