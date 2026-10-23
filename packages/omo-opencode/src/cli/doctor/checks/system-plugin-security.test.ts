import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getPluginInfo } from "./system-plugin"
import { formatDoctorOutput, formatJsonOutput } from "../framework/formatter"
import type { DoctorResult } from "../framework/types"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
for (const name of ["oh-my-openagent", "oh-my-opencode"]) {
  test(`System check ${name} spec hides URL credentials in default, verbose and JSON`, async () => {
    // runner.test.ts replaces the base system module; exercise a fresh real producer.
    const systemModulePath = "./system?credential-url-security"
    const { checkSystem, gatherSystemInfo }: typeof import("./system") = await import(systemModulePath)
    const secret = "sk-test-SYSTEM-DO-NOT-PRINT"
    const token = "eyJhbGci.SYSTEM-DO-NOT-PRINT.signature"
    const home = mkdtempSync(join(tmpdir(), "system-plugin-security-"))
    roots.push(home)
    const previous = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = home
    try {
      mkdirSync(join(home, "project"))
      writeFileSync(join(home, "opencode.json"), JSON.stringify({
        plugin: [`${name}@https://user:${secret}@example.test/plugin.tgz?token=${token}`],
      }))
      const deps = {
        findOpenCodeBinary: async () => ({ binary: "opencode" as const, path: "/fixture/opencode" }),
        getOpenCodeVersion: async () => "1.4.0",
        compareVersions: () => true,
        getPluginInfo,
        getLoadedPluginVersion: () => ({
          cacheDir: home, cachePackagePath: join(home, "package.json"),
          installedPackagePath: join(home, "node_modules/oh-my-openagent/package.json"),
          expectedVersion: "5.1.43", loadedVersion: "5.1.43",
        }),
        getLatestPluginVersion: async () => null,
        getSuggestedInstallTag: () => "latest",
        configExists: () => true,
        readConfigFile: () => "{}",
        parseConfigContent: () => ({}),
      }
      const result = await checkSystem(deps)
      const report: DoctorResult = {
        results: [result], systemInfo: await gatherSystemInfo(deps),
        tools: { lspServers: [], astGrepCli: false, commentChecker: false, ghCli: { installed: false, authenticated: false, username: null }, mcpBuiltin: [], mcpUser: [] },
        summary: { total: 1, passed: 0, failed: 0, warnings: 1, skipped: 0, duration: 0 },
        exitCode: 0, latestVersion: null,
      }
      for (const output of [formatDoctorOutput(report, "default"), formatDoctorOutput(report, "verbose"), formatJsonOutput(report)]) {
        expect(output).not.toContain(secret)
        expect(output).not.toContain(token)
      }
      expect(report.systemInfo.pluginVersion).toBe("https://example.test/plugin.tgz")
      if (name === "oh-my-opencode") expect(result.issues[0]?.fix).toContain("oh-my-openagent@https://example.test/plugin.tgz")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previous
    }
  })
}
