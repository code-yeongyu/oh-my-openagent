import { join } from "node:path"
import { runChild } from "./child-process.js"
import { fetchNpmDistTagsSync } from "./npm-dist-tags.js"
import { channelDistTagVersion, channelPackageSpec, packageManifest, readJson, releaseChannel, resolveSenpi, updateTarget } from "./package-paths.js"
import { isPrintOnlyUpdate, updateUsageAnswer } from "./update-args.js"

export { isPrintOnlyUpdate }

export function formatUpdateCommand(update) {
  return `omo is updated via ${update.manager}: ${update.command}`
}

// npm 11 lists install scripts that no `allowScripts` entry covers. omo's transitive esbuild,
// @google/genai and protobufjs scripts are safe to skip, so the update never passes `--allow-scripts`
// itself; it only explains the notice, because npm's own suggested command has no package name (#9281).
// npm 11 says "have install scripts not yet covered by allowScripts", npm 12 "had install scripts blocked
// because they are not covered by allowScripts"; both carry the `install-scripts` warning prefix.
const ALLOW_SCRIPTS_NOTICE = /^npm warn install-scripts .*covered by allowScripts/im
const SKIPPABLE_SCRIPTS = ["esbuild", "@google/genai", "protobufjs"]

export function formatAllowScriptsGuidance(update) {
  const spec = update.argv[update.argv.length - 1]
  return [
    `omo: npm skipped install scripts for ${SKIPPABLE_SCRIPTS.join(", ")}; skipping them is safe, omo runs without them`,
    `omo: if npm suggested a command without a package name, ignore it; to reinstall use: npm i -g ${spec}`,
  ]
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
 * @typedef {{ stdio?: "inherit", windowsHide?: boolean, env?: NodeJS.ProcessEnv, onOutput?: (text: string) => void }} RunOptions
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
  let npmOutput = ""
  let result
  try {
    result = await run(command, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...env, ...update.env },
      // Only npm reports the notice, so the bun path keeps inheriting the terminal untouched.
      ...(update.manager === "npm"
        ? { onOutput: (text) => { npmOutput += text } }
        : {}),
    })
  } catch {
    error(`omo: update failed; retry with: ${update.command}`)
    return 1
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
  if (ALLOW_SCRIPTS_NOTICE.test(npmOutput)) for (const line of formatAllowScriptsGuidance(update)) log(line)
  return 0
}
