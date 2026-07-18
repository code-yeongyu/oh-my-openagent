import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { callPackagedDaemonTool } from "./daemon-tool-client"
import { resolveSenpiPackagedDaemonRuntime } from "./daemon-runtime"

const tempDirs: string[] = []

async function makePackagedExtensionFixture(): Promise<{ readonly extensionPath: string; readonly cliPath: string; readonly distPath: string }> {
  const pluginRoot = await mkdtemp(join(tmpdir(), "omo-senpi-packaged-runtime-"))
  tempDirs.push(pluginRoot)
  const extensionPath = join(pluginRoot, "extensions", "omo.js")
  const distPath = join(pluginRoot, "runtime", "lsp-daemon", "dist")
  const cliPath = join(distPath, "cli.js")
  await mkdir(join(pluginRoot, "extensions"), { recursive: true })
  await mkdir(distPath, { recursive: true })
  await writeFile(extensionPath, "export default {}\n", "utf8")
  await writeFile(cliPath, "console.log('daemon')\n", "utf8")
  await writeFile(
    join(pluginRoot, "runtime", "lsp-daemon", "dist", "package.json"),
    JSON.stringify({ name: "@code-yeongyu/lsp-daemon", version: "0.1.0", type: "module" }),
    "utf8",
  )
  return { extensionPath, cliPath, distPath }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Senpi packaged daemon runtime resolver", () => {
  test("#given a shipped extension path #when resolving daemon runtime #then CLI and version are paired from plugin-local runtime", async () => {
    // given
    const fixture = await makePackagedExtensionFixture()

    // when
    const runtime = resolveSenpiPackagedDaemonRuntime(pathToFileURL(fixture.extensionPath).href)

    // then
    expect(runtime).toEqual({ cliPath: fixture.cliPath, version: "0.1.0" })
  })

  test("#given a shipped daemon client #when an LSP tool executes #then canonical alias, signal, and Senpi .pi context are forwarded", async () => {
    // given
    const fixture = await makePackagedExtensionFixture()
    await writeFile(
      join(fixture.distPath, "client.js"),
      [
        "export async function callToolViaDaemon(name, args, options) { return { content: [{ type: 'text', text: JSON.stringify({ name, args, context: options.context, signalAborted: options.signal?.aborted === true, signalReason: options.signal?.reason }) }] } }",
      ].join("\n"),
      "utf8",
    )
    const projectDir = await mkdtemp(join(tmpdir(), "omo-senpi-context-project-"))
    const homeDir = await mkdtemp(join(tmpdir(), "omo-senpi-context-home-"))
    tempDirs.push(projectDir, homeDir)
    const originalCwd = process.cwd()
    const originalHome = process.env.HOME
    const signal = AbortSignal.abort("test-abort")

    try {
      process.chdir(projectDir)
      process.env.HOME = homeDir

      // when
      const result = await callPackagedDaemonTool(
        "lsp_goto_definition",
        { filePath: "x.ts", line: 1, character: 0 },
        { signal },
        pathToFileURL(fixture.extensionPath).href,
      )

      // then
      expect(result?.content[0]?.text).toBe(
        JSON.stringify({
          name: "goto_definition",
          args: { filePath: "x.ts", line: 1, character: 0 },
          context: {
            cwd: realpathSync(resolve(projectDir)),
            projectConfigPaths: [join(realpathSync(resolve(projectDir)), ".pi", "lsp-client.json")],
            userConfigPath: join(resolve(homeDir), ".pi", "lsp-client.json"),
            installDecisionsPath: join(resolve(homeDir), ".pi", "lsp-install-decisions.json"),
            capabilities: { installDecisionTool: false },
          },
          signalAborted: true,
          signalReason: "test-abort",
        }),
      )
    } finally {
      process.chdir(originalCwd)
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
    }
  })

  test("#given all six Senpi LSP names #when executing through the packaged client #then canonical Core tool names are used", async () => {
    // given
    const fixture = await makePackagedExtensionFixture()
    await writeFile(
      join(fixture.distPath, "client.js"),
      "export async function callToolViaDaemon(name) { return { content: [{ type: 'text', text: name }] } }\n",
      "utf8",
    )

    const cases = [
      ["lsp_diagnostics", "diagnostics"],
      ["lsp_goto_definition", "goto_definition"],
      ["lsp_find_references", "find_references"],
      ["lsp_symbols", "symbols"],
      ["lsp_prepare_rename", "prepare_rename"],
      ["lsp_rename", "rename"],
    ] as const

    // when
    const results = []
    for (const [senpiName] of cases) {
      results.push(await callPackagedDaemonTool(senpiName, {}, {}, pathToFileURL(fixture.extensionPath).href))
    }

    // then
    expect(results.map((result) => result?.content[0]?.text)).toEqual(cases.map(([, coreName]) => coreName))
  })
})
