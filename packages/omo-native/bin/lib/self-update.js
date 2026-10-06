import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runChild } from "./child-process.js"
import { fetchNpmDistTagsSync } from "./npm-dist-tags.js"
import { channelDistTagVersion, channelPackageSpec, packageManifest, readJson, releaseChannel, resolveSenpi, updateTarget } from "./package-paths.js"
import { isPrintOnlyUpdate, updateUsageAnswer } from "./update-args.js"

export { isPrintOnlyUpdate }

export function formatUpdateCommand(update) {
  return `omo is updated via ${update.manager}: ${update.command}`
}

// npm 11+ ends a global install with an `install-scripts` warning for install scripts that no `allowScripts`
// entry covers (#9281). npm 11 still runs them ("not yet covered"), npm 12 blocks them. The update never
// passes `--allow-scripts` itself; it only explains the notice, because npm's own suggested command has no
// package name. The notice is read from npm's own debug log, not from the child's output, so npm keeps the
// terminal (colour, progress). The log carries the same `<id> warn install-scripts ...` lines the terminal does.
const ALLOW_SCRIPTS_HEADER = /install scripts (blocked because they are not|not yet) covered by allowScripts/
const NOTICE_PACKAGE_LINE = /^(?:npm|\d+) warn install-scripts +((?:@[^/\s@]+\/)?[^@\s]+)(?:@\S+)? \(/gm
// Packages whose install scripts omo does not need; only these are described as safe to skip.
const SKIPPABLE_SCRIPTS = ["esbuild", "@google/genai", "protobufjs"]

/**
 * @param {string} log npm debug log text
 * @returns {{ blocked: boolean, packages: string[] } | null} null when npm reported no allowScripts notice
 */
export function parseAllowScriptsNotice(log) {
  const header = ALLOW_SCRIPTS_HEADER.exec(log)
  if (!header) return null
  const packages = [...new Set([...log.matchAll(NOTICE_PACKAGE_LINE)].map((match) => match[1]))]
  return { blocked: header[1].startsWith("blocked"), packages }
}

export function formatAllowScriptsGuidance(update, notice) {
  const spec = update.argv[update.argv.length - 1]
  const known = notice.packages.filter((name) => SKIPPABLE_SCRIPTS.includes(name))
  const other = notice.packages.filter((name) => !SKIPPABLE_SCRIPTS.includes(name))
  const lines = []
  if (notice.packages.length === 0) {
    lines.push(`omo: npm reported install scripts not covered by allowScripts; ${notice.blocked ? "it blocked them" : "it ran them"}`)
  }
  if (known.length > 0) {
    lines.push(notice.blocked
      ? `omo: npm blocked the install scripts of ${known.join(", ")}; omo works without them`
      : `omo: npm ran the install scripts of ${known.join(", ")}; omo does not need them, so the notice is informational`)
  }
  if (other.length > 0) {
    lines.push(`omo: npm ${notice.blocked ? "blocked" : "ran"} the install scripts of ${other.join(", ")}; omo has not reviewed them`)
  }
  lines.push(`omo: if npm suggested a command without a package name, ignore it; to reinstall use: npm i -g ${spec}`)
  return lines
}

function readNpmDebugLogs(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => /-debug-\d+\.log$/.test(name))
      .sort()
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n")
  } catch {
    return ""
  }
}

export function readInstalledVersion() {
  let engine = "unknown"
  try {
    engine = readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    // The product version is still reportable when the engine tree cannot be resolved.
  }
  return { omo: packageManifest().version, engine }
}

export function formatVersionChange(before, after) {
  return `omo ${before.omo} -> ${after.omo} (engine: senpi ${after.engine})`
}

/**
 * Resolves the version the running build's channel dist-tag names (the lookup `omo doctor` uses for
 * "Latest"), then prints and optionally runs the package-manager command that installs exactly that
 * version. `--help`/`-h` print the usage and an unknown flag exits 2, both before the registry lookup,
 * so neither can install anything (#9207). `--dry-run` and `--print` print the resolved command only.
 * Already on the target, it says so and installs nothing. After a manager exit 0 it re-reads the installed version: one that did not
 * reach the target exits non-zero with the retry command, because the manager's own success does not
 * prove the install moved (#9198). An unreachable registry falls back to the unpinned channel spec.
 * `run` defaults to `runChild` so tests inject a spawn without touching the child-process helper.
 *
 * @typedef {{ omo: string, engine: string }} InstalledVersion
 * @typedef {{ status: number | null, signal: string | null }} ChildResult
 * @typedef {{ stdio?: "inherit", windowsHide?: boolean, env?: NodeJS.ProcessEnv }} RunOptions
 * @typedef {{ manager: string, command: string, argv: string[], env?: Record<string, string> }} UpdateTarget
 * @typedef {{
 *   resolveUpdate?: (targetVersion?: string) => UpdateTarget,
 *   fetchDistTags?: () => Record<string, unknown> | null,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 *   run?: (command: string, args: string[], options?: RunOptions) => Promise<ChildResult>,
 *   readInstalled?: () => InstalledVersion,
 *   env?: NodeJS.ProcessEnv,
 * }} SelfUpdateOptions
 * @param {string[]} args
 * @param {SelfUpdateOptions} [options]
 * @returns {Promise<number>}
 */
export async function runSelfUpdate(args, options = {}) {
  const resolveUpdate = options.resolveUpdate
    ?? ((targetVersion) => updateTarget(undefined, undefined, undefined, undefined, undefined, targetVersion))
  const fetchDistTags = options.fetchDistTags ?? fetchNpmDistTagsSync
  const log = options.log ?? ((line) => console.log(line))
  const error = options.error ?? ((line) => console.error(line))
  const run = options.run ?? runChild
  const readInstalled = options.readInstalled ?? readInstalledVersion
  const env = options.env ?? process.env

  const usage = updateUsageAnswer(args)
  if (usage !== undefined) {
    ;(usage.stream === "stderr" ? error : log)(usage.text)
    return usage.exitCode
  }

  const before = readInstalled()
  const channel = releaseChannel(before.omo)
  const target = channelDistTagVersion(fetchDistTags(), before.omo)
  const update = resolveUpdate(target)

  if (target === undefined) {
    log(`omo: could not confirm the ${channel} omo-ai version from the npm registry; installing the unpinned ${channelPackageSpec(before.omo)}`)
  }
  if (isPrintOnlyUpdate(args)) {
    log(formatUpdateCommand(update))
    return 0
  }
  if (target !== undefined && target === before.omo) {
    log(`omo ${before.omo} is up to date (omo-ai@${channel} is ${target})`)
    return 0
  }
  log(formatUpdateCommand(update))

  const [command, ...argv] = update.argv
  // npm keeps the inherited terminal; its debug log, pinned to a fresh directory, is where the notice is read.
  const npmLogsDir = update.manager === "npm" ? mkdtempSync(join(tmpdir(), "omo-npm-logs-")) : undefined
  let result
  let npmLog = ""
  try {
    result = await run(command, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...env, ...update.env, ...(npmLogsDir ? { npm_config_logs_dir: npmLogsDir } : {}) },
    })
  } catch {
    error(`omo: update failed; retry with: ${update.command}`)
    return 1
  } finally {
    if (npmLogsDir) {
      npmLog = readNpmDebugLogs(npmLogsDir)
      rmSync(npmLogsDir, { recursive: true, force: true })
    }
  }

  if (result.signal || (result.status ?? 1) !== 0) {
    error(`omo: update failed; retry with: ${update.command}`)
    return result.status ?? 1
  }

  const after = readInstalled()
  if (target !== undefined && after.omo !== target) {
    error(`omo is still ${after.omo}; ${target} is published`)
    error(`omo: update failed; retry with: ${update.command}`)
    return 1
  }
  log(formatVersionChange(before, after))
  const notice = parseAllowScriptsNotice(npmLog)
  if (notice) for (const line of formatAllowScriptsGuidance(update, notice)) log(line)
  return 0
}
