import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildKeychainHelper, type KeychainHelperBuild } from "../keychain-helper/build"

export const ACCOUNT = "a".repeat(64)
// A backstop only: full-directory runs under load have failed intermittently with an unnamed hook timeout whose
// cause is not yet identified (#11607). Remove this budget once #11607 finds and fixes the cause.
export const NATIVE_BUILD_BUDGET_MS = 120_000
export const isDarwin = process.platform === "darwin"
const nativeArch = process.arch === "arm64" ? "arm64" : "x86_64"

export type HelperReply = Record<string, unknown>
export type HelperRun = { readonly reply: HelperReply | null; readonly exitCode: number; readonly stdout: string }

export type Harness = {
  readonly dir: string
  readonly keychain: string
  readonly helper: string
  readonly buildFlavor: (name: string, build: Omit<KeychainHelperBuild, "output">) => Promise<string>
  readonly fixture: (op: string, ...args: string[]) => Promise<string>
  readonly run: (request: object | string, options?: { readonly binary?: string; readonly args?: readonly string[] }) => Promise<HelperRun>
  readonly dispose: () => Promise<void>
}

async function output(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe", env: {} })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}: ${stderr}${stdout}`)
  return stdout
}

/** The user's keychain search list, read only: the tests prove they leave it exactly as they found it. */
export const userSearchList = (): Promise<string> => output(["/usr/bin/security", "list-keychains", "-d", "user"])

export async function readLine(stream: ReadableStream<Uint8Array>): Promise<{ readonly line: string; readonly rest: Promise<string> }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
  }
  const rest = (async () => {
    let tail = ""
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return tail
      tail += decoder.decode(chunk.value, { stream: true })
    }
  })()
  return { line: text, rest }
}

const isReply = (value: unknown): value is HelperReply => typeof value === "object" && value !== null && !Array.isArray(value)

export async function createHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "omo-keychain-helper-"))
  const keychain = join(dir, "throwaway.keychain-db")
  const helper = join(dir, "omo-keychain-test")
  const fixtureBinary = join(dir, "keychain-fixture")
  await buildKeychainHelper({ output: helper, flavor: "test", architectures: [nativeArch] })
  await output([
    "clang",
    "-std=c11",
    "-Wno-deprecated-declarations",
    "-framework",
    "Security",
    "-framework",
    "CoreFoundation",
    "-o",
    fixtureBinary,
    join(import.meta.dir, "..", "keychain-helper", "test-support", "keychain-fixture.c"),
  ])
  const fixture = (op: string, ...args: string[]) => output([fixtureBinary, op, keychain, ...args])
  await fixture("create")

  const run: Harness["run"] = async (request, options = {}) => {
    const args = options.args ?? ["--keychain", keychain, "--no-ui"]
    const child = Bun.spawn([options.binary ?? helper, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: {} })
    child.stdin.write(`${typeof request === "string" ? request : JSON.stringify(request)}\n`)
    child.stdin.flush()
    const { line, rest } = await readLine(child.stdout)
    child.stdin.end()
    const [tail, exitCode] = await Promise.all([rest, child.exited])
    const trimmed = line.trim()
    const parsed: unknown = trimmed === "" ? null : JSON.parse(trimmed)
    return { reply: isReply(parsed) ? parsed : null, exitCode, stdout: line + tail }
  }

  return {
    dir,
    keychain,
    helper,
    fixture,
    run,
    buildFlavor: async (name, build) => {
      const binary = join(dir, name)
      await buildKeychainHelper({ ...build, output: binary, architectures: [nativeArch] })
      return binary
    },
    dispose: async () => {
      if (existsSync(keychain)) await fixture("destroy")
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
