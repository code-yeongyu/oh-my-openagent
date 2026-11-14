import { type SpawnSyncReturns, spawnSync as nodeSpawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { resolveAgentHome } from "../components/agent-home/resolve-agent-home"
import { runSenpiInstaller, runSenpiUninstaller, type SenpiInstallOptions } from "./install-senpi"
import {
  installLocalLauncher,
  type LocalLauncherOptions,
  localLauncherPath,
  uninstallLocalLauncher,
} from "./local-launcher"

const REQUIRED_SKILL_NAMES = [
  "ast-grep",
  "browser",
  "coding-agent-sessions",
  "debugging",
  "frontend",
  "git-master",
  "init-deep",
  "lsp-setup",
  "programming",
  "refactor",
  "remove-ai-slops",
  "review-work",
  "ultimate-browsing",
  "ultrawork",
  "ulw-execute",
  "ulw-loop",
  "ulw-plan",
  "ulw-research",
  "visual-qa",
] as const

export async function createPluginFixture(
  options: { readonly runtime?: boolean } = { runtime: true },
): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-senpi-plugin-fixture-"))
  await writeFixtureFile(join(pluginPath, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
  await writeFixtureFile(join(pluginPath, "extensions", "omo.js"), "export default {}\n")
  await writeFixtureFile(
    join(pluginPath, "extensions", "omo-task.js"),
    "export const createTaskComponent = () => ({})\n",
  )
  await writeFixtureFile(join(pluginPath, "extensions", "omo-computer-use.js"), "export {}\n")
  for (const sidecar of ["omo-side-panel.js", "omo-onboarding-scan.js", "omo-init-deep-advisor.js"]) {
    await writeFixtureFile(join(pluginPath, "extensions", sidecar), "export {}\n")
  }
  await writeFixtureFile(join(pluginPath, "extensions", "omo-memory-doctor.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-memory-memfs.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-memory-palace.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-device-account.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-memory-commands.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-session-history.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-recall-store.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-device-service.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-telemetry-posthog.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-telemetry-otlp.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-memory-sync.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "loro_wasm_bg.wasm"), "")
  await writeFixtureFile(join(pluginPath, "extensions", "CaseFolding.txt"), "")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-thread-client.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-telemetry-recovery.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-feedback.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-desktop-toolkit.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-claim-receipt.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "assets.generated.json"), "{}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit-sdk", "sdk.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "bunshin-ts", "sdk.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "thread-sdk", "sdk.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-member.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "memory-run-supervisor.mjs"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "gateway-store-worker.mjs"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-computer-run-worker.mjs"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "quickjs.wasm"), "")
  await writeFixtureFile(join(pluginPath, "extensions", "reflection-persona.md"), "# reflection persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "dream-persona.md"), "# dream persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "facts-persona.md"), "# facts persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "kibitzer-persona.md"), "# kibitzer persona fixture\n")
  for (const skillName of REQUIRED_SKILL_NAMES) {
    await writeFixtureFile(join(pluginPath, "skills", skillName, "SKILL.md"), `# ${skillName}\n`)
  }
  // The browser skill's bundled omowright runtime is a required payload artifact (issue #9661);
  // the fixture mirrors the required set so the installer's integrity check passes.
  await writeFixtureFile(join(pluginPath, "skills", "browser", "runtime", "omowright", "index.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "skills", "browser", "runtime", "omowright", "page-bundle.js"), "\n")
  // Credential-gated skill: staged outside pi.skills but still a required payload artifact.
  await writeFixtureFile(join(pluginPath, "skills-conditional", "x-search", "SKILL.md"), "# x-search\n")
  await writeFixtureFile(join(pluginPath, "scripts", "install.mjs"), "#!/usr/bin/env node\n")
  // The task daemon's launch spec is a required root-level artifact; the installer's integrity
  // check refuses a payload without it.
  await writeFixtureFile(
    join(pluginPath, "daemon-launch-spec.json"),
    '{"spec_version":1,"core":{"session_runtime":"in-process","multi_session":true,"extensions":["."]},"tunables":{},"env":{}}\n',
  )
  if (options.runtime !== false) {
    const astGrepRuntime = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    await writeFixtureFile(astGrepRuntime, "console.log('ast-grep')\n")
    await chmod(astGrepRuntime, 0o755)
    const astGrepRuntimeBytes = await readFile(astGrepRuntime)
    await writeFixtureFile(
      join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"),
      `${JSON.stringify(
        {
          sha256: createHash("sha256").update(astGrepRuntimeBytes).digest("hex"),
          mode: 0o755,
          stagedAtUtc: "2026-08-03T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
    )
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "cli.js"), "export {}\n")
    await writeFixtureFile(
      join(pluginPath, "runtime", "agent-toolkit", "ulw-loop", "cli.js"),
      "console.log('ulw-loop')\n",
    )
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit"), "#!/bin/sh\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit.cmd"), "@echo off\r\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "cli.js"), "console.log('cli')\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.d.ts"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.d.ts"), "export {}\n")
    await writeFixtureFile(
      join(pluginPath, "runtime", "lsp-daemon", "dist", "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    )
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"), "{}\n")
  }
  return pluginPath
}

export async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

// Every install, launcher write and launcher spawn a test runs goes through this sandbox (#13192, #13253): the installer
// writes the omo launcher under the resolved home and the settings under the resolved agent dir, and the launcher reads
// its engine, plugin and agent dir from the environment, so a test that forgot HOME once replaced the real launcher.
// The sandbox owns one temp root holding home, XDG dirs and the agent dir; it refuses, before any write or spawn, a
// launcher, settings, agent-dir, CLI or plugin path that resolves outside that root.
export interface InstallSandbox {
  readonly root: string
  readonly home: string
  readonly agentDir: string
  readonly env: Readonly<Record<string, string>>
  readonly tempDir: (prefix: string) => Promise<string>
  readonly tempDirSync: (prefix: string) => string
  readonly install: (options?: SenpiInstallOptions) => ReturnType<typeof runSenpiInstaller>
  readonly uninstall: (options?: SenpiInstallOptions) => ReturnType<typeof runSenpiUninstaller>
  readonly installLauncher: (options: Omit<LocalLauncherOptions, "homeDir">) => string | undefined
  readonly uninstallLauncher: () => boolean
  readonly spawnSync: (
    command: string,
    args: readonly string[],
    env?: Readonly<Record<string, string>>,
  ) => SpawnSyncReturns<string>
  readonly dispose: () => Promise<void>
}

const AGENT_DIR_VARIABLES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const
const SPAWN_PATH_VARIABLES = [
  "OMO_SENPI_CLI_PATH",
  "OMO_PLUGIN_ROOT",
  ...AGENT_DIR_VARIABLES,
  "HOME",
  "USERPROFILE",
] as const

function insideRoot(root: string, path: string): boolean {
  const offset = relative(root, resolve(path))
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))
}

export function assertInsideSandbox(root: string, options: SenpiInstallOptions): void {
  const env = options.env ?? {}
  const homeDir = options.homeDir ?? env.HOME
  if (homeDir === undefined)
    throw new Error("install sandbox: no home; the installer would use the real home directory")
  const agentDir = resolve(options.agentDir ?? resolveAgentHome({ env, homeDir }))
  for (const [what, path] of [
    ["launcher", localLauncherPath(homeDir)],
    ["settings", join(agentDir, "settings.json")],
  ] as const) {
    if (!insideRoot(root, path)) throw new Error(`install sandbox: ${what} path ${path} is outside ${root}`)
  }
}

/** The explicit environment of a launcher spawn: nothing the launcher resolves paths from is inherited. */
export function sandboxSpawnEnv(
  root: string,
  base: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const passthrough: Record<string, string> = {}
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec"]) {
    const value = process.env[name]
    if (value !== undefined) passthrough[name] = value
  }
  const env: Record<string, string> = { ...passthrough, TMPDIR: root, TEMP: root, TMP: root, ...base, ...extra }
  for (const name of SPAWN_PATH_VARIABLES) {
    const value = env[name]
    if (value !== undefined && !insideRoot(root, value)) {
      throw new Error(`install sandbox: spawn ${name}=${value} is outside ${root}`)
    }
  }
  return env
}

export function createInstallSandbox(): InstallSandbox {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-install-sandbox-"))
  const home = join(root, "home")
  const agentDir = join(root, "agent")
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_STATE_HOME: join(root, "xdg-state"),
    XDG_BIN_HOME: join(root, "xdg-bin"),
  }
  // Installs take SENPI_CODING_AGENT_DIR (a case may give its own scratch one); OMO_ and PI_ outrank it, so they are set
  // only in the explicit environment of a spawn.
  env.SENPI_CODING_AGENT_DIR = agentDir
  const spawnEnv: Record<string, string> = { ...env }
  for (const name of AGENT_DIR_VARIABLES) spawnEnv[name] = agentDir
  for (const dir of [home, agentDir]) mkdirSync(dir, { recursive: true })
  const scoped = (options: SenpiInstallOptions = {}): SenpiInstallOptions => {
    const mergedEnv = { ...env, ...options.env }
    // options.homeDir wins over env.HOME in the installer (install-senpi.ts), so it is always set here.
    const merged = { ...options, homeDir: options.homeDir ?? mergedEnv.HOME, env: mergedEnv }
    assertInsideSandbox(root, merged)
    return merged
  }
  return {
    root,
    home,
    agentDir,
    env,
    tempDir: (prefix) => mkdtemp(join(root, prefix)),
    tempDirSync: (prefix) => mkdtempSync(join(root, prefix)),
    install: (options) => runSenpiInstaller(scoped(options)),
    uninstall: (options) => runSenpiUninstaller(scoped(options)),
    installLauncher: (options) => installLocalLauncher({ ...options, homeDir: home }),
    uninstallLauncher: () => uninstallLocalLauncher(home),
    spawnSync: (command, args, extra) =>
      nodeSpawnSync(command, [...args], {
        encoding: "utf8",
        windowsHide: true,
        env: sandboxSpawnEnv(root, spawnEnv, extra),
      }),
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}
