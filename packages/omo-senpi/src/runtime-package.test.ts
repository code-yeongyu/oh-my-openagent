import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  stageLspDaemonRuntime,
  verifyRuntimeDist,
} from "../plugin/scripts/stage-lsp-daemon-runtime.mjs"

const tempDirs: string[] = []

type JsonObject = Record<string, unknown>

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function makeRuntimeFixture(): Promise<{
  readonly repoRoot: string
  readonly sourceDist: string
  readonly targetDist: string
  readonly inputCandidates: readonly string[]
}> {
  const repoRoot = await makeTempDir("omo-senpi-runtime-repo-")
  const sourceDist = join(repoRoot, "packages", "lsp-daemon", "dist")
  const targetDist = join(repoRoot, "packages", "omo-senpi", "plugin", "runtime", "lsp-daemon", "dist")
  await writeText(join(sourceDist, "cli.js"), "console.log('cli')\n")
  await writeText(join(sourceDist, "index.js"), "export {}\n")
  await writeText(join(sourceDist, "index.d.ts"), "export {}\n")
  await writeText(join(sourceDist, "client.js"), "export {}\n")
  await writeText(join(sourceDist, "client.d.ts"), "export {}\n")
  await writeText(join(sourceDist, "daemon-client.js"), "export {}\n")
  await writeText(join(sourceDist, "daemon-client.d.ts"), "export {}\n")
  await writeText(join(sourceDist, "package.json"), JSON.stringify({ name: "@code-yeongyu/lsp-daemon", version: "0.1.0", type: "module" }))
  await writeText(join(repoRoot, "packages", "lsp-daemon", "src", "index.ts"), "export const daemon = true\n")
  await writeText(join(repoRoot, "packages", "lsp-core", "src", "index.ts"), "export const core = true\n")
  await writeText(join(repoRoot, "packages", "mcp-stdio-core", "src", "index.ts"), "export const mcp = true\n")
  return {
    repoRoot,
    sourceDist,
    targetDist,
    inputCandidates: [
      "packages/lsp-daemon/src",
      "packages/lsp-core/src",
      "packages/mcp-stdio-core/src",
    ],
  }
}

async function readJsonObject(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
  return parsed
}

afterEach(async () => {
  delete process.env.OMO_SENPI_STAGE_FAIL_AFTER_BACKUP
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Senpi LSP daemon runtime staging", () => {
  test("#given daemon build outputs #when staged #then manifest pins sorted outputs and verifies", async () => {
    // given
    const fixture = await makeRuntimeFixture()

    // when
    const result = await stageLspDaemonRuntime(fixture)
    const manifest = await readJsonObject(result.manifestPath)
    const verification = await verifyRuntimeDist(fixture.targetDist)

    // then
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      version: "0.1.0",
      inputDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect(verification.ok).toBe(true)
    expect(verification.outputs.map((output) => output.path)).toEqual([
      "cli.js",
      "client.d.ts",
      "client.js",
      "daemon-client.d.ts",
      "daemon-client.js",
      "index.d.ts",
      "index.js",
      "package.json",
    ])
  })

  test("#given a tampered staged output #when verified #then manifest mismatch is rejected", async () => {
    // given
    const fixture = await makeRuntimeFixture()
    await stageLspDaemonRuntime(fixture)
    await writeFile(join(fixture.targetDist, "cli.js"), "console.log('tampered')\n", "utf8")

    // when
    const failure = verifyRuntimeDist(fixture.targetDist)

    // then
    await expect(failure).rejects.toThrow("manifest output hash mismatch")
  })

  test("#given an existing staged runtime #when replacement fails after backup #then prior bytes are restored", async () => {
    // given
    const fixture = await makeRuntimeFixture()
    await mkdir(fixture.targetDist, { recursive: true })
    await writeFile(join(fixture.targetDist, "cli.js"), "old cli\n", "utf8")
    process.env.OMO_SENPI_STAGE_FAIL_AFTER_BACKUP = "1"

    // when
    const failure = stageLspDaemonRuntime(fixture)

    // then
    await expect(failure).rejects.toThrow("Injected Senpi runtime staging failure")
    expect(await readFile(join(fixture.targetDist, "cli.js"), "utf8")).toBe("old cli\n")
  })
})

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
