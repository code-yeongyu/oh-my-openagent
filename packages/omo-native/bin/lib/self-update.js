import { INSTALL_EXIT_BY_CODE, INSTALL_FAILED_EXIT, readInstalledVersion, update } from "./install-calls.js"
import { isPrintOnlyUpdate, updateUsageAnswer } from "./update-args.js"
import { versionedUpdateLines } from "./versioned-install.js"

export { isPrintOnlyUpdate, readInstalledVersion }

export function formatUpdateCommand(update) {
  return `omo is updated via ${update.manager}: ${update.command}`
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
 * When the running package sits in a side-by-side versions layout (`<versions>/current -> <version>`,
 * #12022), the update installs the target into a new version dir with bun and switches `current`
 * (`versioned-install.js`) instead of `npm i -g`, which would install a copy PATH never runs.
 *
 * On Windows a manager failure whose stderr says a file is held (EPERM/EBUSY, #10090) is retried with
 * backoff. If the file stays held, the report names the file, the processes of this install that hold it
 * and one action, and only an install that can no longer be read is reinstalled at the previous version; any readable version is kept.
 *
 * @typedef {{ omo: string, engine: string }} InstalledVersion
 * @typedef {{ status: number | null, signal: string | null, stderr?: string }} ChildResult
 * @typedef {{ stdio?: "inherit", windowsHide?: boolean, env?: NodeJS.ProcessEnv, captureStderr?: boolean, cwd?: string }} RunOptions
 * @typedef {import("./update-lock.js").ProcessEntry} ProcessEntry
 * @typedef {{ manager: string, command: string, argv: string[], env?: Record<string, string> }} UpdateTarget
 * @typedef {{
 *   resolveUpdate?: (targetVersion?: string) => UpdateTarget,
 *   fetchDistTags?: () => Record<string, unknown> | null,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 *   run?: (command: string, args: string[], options?: RunOptions) => Promise<ChildResult>,
 *   readInstalled?: () => InstalledVersion,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   sleep?: (ms: number) => Promise<void>,
 *   listProcesses?: () => ProcessEntry[],
 *   installDir?: string,
 *   selfPids?: number[],
 *   root?: string,
 * }} SelfUpdateOptions
 * @param {string[]} args
 * @param {SelfUpdateOptions} [options]
 * @returns {Promise<number>}
 */
export async function runSelfUpdate(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line))
  const error = options.error ?? ((line) => console.error(line))
  const usage = updateUsageAnswer(args)
  if (usage !== undefined) {
    ;(usage.stream === "stderr" ? error : log)(usage.text)
    return usage.exitCode
  }
  const { log: _log, error: _error, ...ports } = options
  const answer = await update(
    { dry_run: isPrintOnlyUpdate(args) },
    { ...ports, onProgress: (event) => renderProgress(event, log, error) },
  )
  if (answer.kind === "ok") {
    const value = answer.value
    if (value.state === "printed") log(formatUpdateCommand({ manager: value.manager, command: value.command_line }))
    else if (value.state === "up_to_date")
      log(`omo ${value.before.omo} is up to date (omo-ai@${value.channel} is ${value.version})`)
    else if (value.versioned !== undefined) {
      log(
        `omo ${value.before.omo} -> ${value.version} (${value.versioned.final_dir}; ${value.versioned.kept} is kept for rollback)`,
      )
    } else log(formatVersionChange(value.before, value.after))
    return 0
  }
  for (const line of failureLines(answer.error)) error(line)
  return exitCodeOf(answer.error)
}

function renderProgress(event, log, error) {
  if (event.kind === "unpinned") {
    log(
      `omo: could not confirm the ${event.channel} omo-ai version from the npm registry; installing the unpinned ${event.spec}`,
    )
  } else if (event.kind === "installing") log(formatUpdateCommand(event))
  else if (event.kind === "retrying") {
    log(
      `omo: ${event.file ?? "a package file"} is held by another process; retrying in ${event.delay_ms / 1000}s (attempt ${event.attempt} of ${event.attempts})`,
    )
  } else if (event.kind === "held") {
    error(
      `omo: update stopped: Windows would not let the package manager replace ${event.file ?? "a package file"}; it was still held after ${event.attempts} attempts.`,
    )
    if (event.holders.length > 0) {
      error(`omo: held by ${event.holders.map((holder) => `${holder.name} (pid ${holder.pid})`).join(", ")}`)
      const names = [...new Set(event.holders.map((holder) => holder.name))].join(", ")
      error(`omo: Quit ${names} and run omo update again.`)
    } else {
      error(
        "omo: No omo command-line process was found holding it. Another app (for example the OmO desktop app or an editor) or antivirus may be holding it: close it, or wait a minute, then run omo update again.",
      )
    }
  }
}

function exitCodeOf(failure) {
  if (failure.code !== "install_failed") return INSTALL_EXIT_BY_CODE[failure.code] ?? 1
  const exit = INSTALL_FAILED_EXIT[failure.details.reason]
  return exit === "exit_status" ? failure.details.exit_status : exit
}

const VERSIONED_KIND = {
  no_bun: "no_bun",
  busy: "busy",
  bun_install_failed: "install_failed",
  wrong_version: "wrong_version",
  path_still_old: "not_on_path",
}

function failureLines(failure) {
  const details = failure.details ?? {}
  const retry = `omo: update failed; retry with: ${details.command}`
  switch (details.reason) {
    case "registry_unconfirmed":
      return [
        `omo: could not confirm the ${details.channel} omo-ai version from the npm registry; ${details.versions_dir} installs exact versions only, so retry when the registry answers`,
      ]
    case "engine_missing":
      return [
        `omo ${details.before} is up to date, but its engine files are missing or incomplete; reinstall with: ${details.command}`,
      ]
    case "versioned": {
      const lines = versionedUpdateLines(
        {
          kind: VERSIONED_KIND[details.cause],
          finalDir: details.final_dir,
          holder: details.holder,
          reported: details.reported,
          updated: details.updated,
          onPath: details.on_path,
          onPathReal: details.on_path_real,
          seen: details.seen,
          exitCode: details.exit_status,
        },
        {
          install: { versionsDir: details.versions_dir, current: details.current, versionDir: details.version_dir },
          before: details.before,
          target: details.target,
        },
      )
      return [...lines.log, ...lines.error]
    }
    case "not_moved":
      return [`omo is still ${details.after}; ${details.target} is published`, retry]
    case "file_held":
      if (details.restore === "not_needed") {
        return details.installed_now === details.before
          ? [`omo: omo ${details.before} is still installed.`]
          : [
              `omo: omo ${details.installed_now} is installed, but the package manager did not finish; run omo update again afterwards to complete it.`,
            ]
      }
      if (details.restore === "restored") return [`omo: restored omo ${details.before}.`]
      return [
        `omo: the previous omo ${details.before} could not be restored; ${details.holders.length > 0 ? "after quitting the holder" : "once the file is released"}, run: ${details.previous_command}`,
      ]
    default:
      return [retry]
  }
}
