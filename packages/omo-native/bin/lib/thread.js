import { readFileSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { integerOption, parseArgs, stateOption, THREAD_EXIT, THREAD_STATES } from "./thread-args.js"
import { humanLines } from "./thread-output.js"

export { THREAD_EXIT } from "./thread-args.js"

/**
 * `omo thread` - the session gateway for scripts and connectors: every thread operation the agent
 * tools offer, run through the plugin's thread SDK (`plugin/runtime/thread-sdk/sdk.js`) as
 * `cli:<uid>`. It never starts a host: sessions are listed from the endpoints the engine's registry names, and
 * receipts live in the gateway store. JSON shapes: docs/reference/omo-thread.md.
 */

const USAGE = [
  "usage: omo thread <list|send|read|close> [options] [--json]",
  "",
  "  list      [--all-scope] [--state running|idle|inactive|archived[,...]]  (repeatable; default: all but archived)",
  "  send      <target> <text> [--mode auto|steer|follow_up] [--expected-turn <n>] [--idempotency-key <k>]",
  "  read      <target> [--limit <items>] [--max-bytes <n>] [--cursor <c>]",
  "  close     <target> [--force | --graceful [--wait-ms <n>]] [--idempotency-key <k>]",
  "",
  "  <target>/<session> takes a thread id, session id, alias, exact name, unique id prefix,",
  "                or <device>/<thread> (device: id, here, name or unique device id prefix)",
  "",
  "  --all-scope  resolve sessions in every workspace, not only this directory's",
  "  --json       print the result as one JSON value",
].join("\n")

const COMMON = ["--json", "--all-scope"]

const COMMANDS = {
  list: {
    values: ["--state"],
    repeatable: ["--state"],
    booleans: [],
    arity: [0, 0],
    call: (sdk, _p, o, scope) => {
      const state = stateOption(o)
      return sdk.list(state === undefined ? scope : { ...scope, state })
    },
  },
  send: {
    values: ["--mode", "--expected-turn", "--idempotency-key"],
    booleans: [],
    arity: [2, 2],
    call: (sdk, p, o, scope) =>
      sdk.send({
        ...scope,
        thread: p[0],
        text: p[1],
        mode: o["--mode"],
        expected_turn_id: integerOption(o, "--expected-turn"),
        idempotency_key: o["--idempotency-key"],
      }),
  },
  read: {
    values: ["--limit", "--max-bytes", "--cursor"],
    booleans: [],
    arity: [1, 1],
    call: async (sdk, p, o, scope) =>
      lastItems(
        await sdk.read({ ...scope, thread: p[0], max_bytes: integerOption(o, "--max-bytes"), cursor: o["--cursor"] }),
        integerOption(o, "--limit"),
      ),
  },
  close: {
    values: ["--wait-ms", "--idempotency-key"],
    booleans: ["--force", "--graceful"],
    arity: [1, 1],
    // omo#14313: the thread_close tool's body; --graceful lets the turn end and hands unread messages back.
    call: (sdk, p, o, scope, flags) =>
      sdk.close({
        ...scope,
        thread: p[0],
        ...(flags.has("--force") ? { force: true } : {}),
        ...(flags.has("--graceful") ? { graceful: true } : {}),
        wait_ms: integerOption(o, "--wait-ms"),
        idempotency_key: o["--idempotency-key"],
      }),
  },
}

const INTEGER_FLAGS = ["--expected-turn", "--limit", "--max-bytes"]
const CHOICE_FLAGS = { "--mode": ["auto", "steer", "follow_up"] }

function lastItems(result, limit) {
  if (limit === undefined || result.kind !== "ok") return result
  return { ...result, items: result.items.slice(Math.max(0, result.items.length - limit)) }
}

function validate(name, parsed) {
  const [min, max] = COMMANDS[name].arity
  const count = parsed.positionals.length
  if (count < min || count > max) return `expects ${min === max ? min : `${min}-${max}`} argument(s), got ${count}`
  for (const flag of INTEGER_FLAGS)
    if (Number.isNaN(integerOption(parsed.options, flag) ?? 0)) return `${flag} must be a non-negative integer`
  const unknownState = (stateOption(parsed.options) ?? []).find((state) => !THREAD_STATES.includes(state))
  if (unknownState !== undefined) return `--state must be one of ${THREAD_STATES.join(", ")}, got '${unknownState}'`
  for (const [flag, choices] of Object.entries(CHOICE_FLAGS)) {
    const value = parsed.options[flag]
    if (value !== undefined && !choices.includes(value))
      return `${flag} must be one of ${choices.join(", ")}, got '${value}'`
  }
  if (name === "send" && parsed.positionals[1].trim() === "") return "<text> is empty"
  return undefined
}

/** With `--json`, a failure the CLI answers itself is printed in the SDK's error shape, so stdout is always one JSON value. */
function refuse({ stdout, stderr }, json, code, line, nextAction) {
  if (json)
    stdout.write(`${JSON.stringify({ kind: "error", error: { code, message: line, next_action: nextAction } })}\n`)
  stderr.write(`${line}\n`)
}

/** `--json` among the options, before `--`: a usage error is still answered in JSON when the parse itself failed. */
function launchJson(args) {
  const end = args.indexOf("--")
  return (end === -1 ? args : args.slice(0, end)).includes("--json")
}

export function threadExitCode(result) {
  if (result?.kind === "ok") return THREAD_EXIT.ok
  const code = result?.error?.code
  if (code === "host_unavailable") return THREAD_EXIT.unavailable
  if (code === "internal_error") return THREAD_EXIT.failed
  return THREAD_EXIT.refused
}

/**
 * Loads the SDK the plugin ships. `node:sqlite` is probed lazily first (as `setup-detect.js` does):
 * the gateway store needs it, and a runtime without it gets a named refusal, not a worker crash.
 * The answer is `{ sdk }` or `{ error, code }`: `unsupported` for the runtime, `internal_error` for a
 * plugin SDK that cannot be imported (a broken or partial install).
 */
export async function loadThreadSdk({
  pluginRoot,
  agentDir,
  env,
  cwd,
  stderr,
  reinstall,
  loadSqlite,
  importSdk,
  importThreadClient = () => import(pathToFileURL(threadClientPath(pluginRoot)).href),
  identity,
}) {
  try {
    await (loadSqlite ?? (() => import("node:sqlite")))()
  } catch {
    return {
      code: "unsupported",
      error: `node:sqlite is unavailable in this runtime (${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`}); the session gateway store needs it`,
    }
  }
  let module
  try {
    module = await (
      importSdk ?? (() => import(pathToFileURL(join(pluginRoot, "runtime", "thread-sdk", "sdk.js")).href))
    )()
  } catch (error) {
    return {
      code: "internal_error",
      error: `the plugin's thread SDK could not be loaded from ${join(pluginRoot, "runtime", "thread-sdk")}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const who = identity ?? { uid: process.getuid?.() ?? 0, user: userInfo().username }
  const remote = await cliRemoteSurface({ pluginRoot, env, cwd, stderr, reinstall, importThreadClient })
  return {
    sdk: module.createThreadSdk({
      agentDir,
      cwd,
      uid: who.uid,
      user: who.user,
      env,
      ...(remote === undefined ? {} : { remote }),
    }),
  }
}

/**
 * The account's other devices and its alias registry for `omo thread` (#12833), from the plugin's own thread client and
 * device-account sidecars: `read` then resolves an alias or another device's thread as the agent tools do. A plugin
 * whose thread client does not offer it keeps the local-only behavior. A thread client that cannot be imported is a
 * broken install: the local-only behavior stays, and stderr says aliases and other devices are unreachable (#12848).
 * The SDK closes it on dispose.
 */
async function cliRemoteSurface({ pluginRoot, env, cwd, stderr, reinstall, importThreadClient }) {
  let client
  try {
    client = await importThreadClient()
  } catch (error) {
    stderr.write(
      `omo: the plugin's thread client could not be loaded from ${threadClientPath(pluginRoot)} (${error instanceof Error ? error.message : String(error)}); aliases and other devices' threads are unreachable, only this device's threads are.\n  next: ${reinstall ?? "Reinstall omo, then retry."}\n`,
    )
    return undefined
  }
  if (typeof client.createCliRemoteSurface !== "function") return undefined
  let version = "0.0.0"
  try {
    const declared = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")).version
    if (typeof declared === "string") version = declared
  } catch {
    // A plugin manifest that cannot be read only loses the version the device service is told; reads still work.
  }
  const loadAccess = async () =>
    (await import(pathToFileURL(join(pluginRoot, "extensions", "omo-device-account.js")).href)).cliServiceAccess({
      env,
      cwd,
      log: (line) => stderr.write(`omo: ${line}\n`),
    })
  return client.createCliRemoteSurface({ version, loadAccess })
}

function threadClientPath(pluginRoot) {
  return join(pluginRoot, "extensions", "omo-thread-client.js")
}

export async function runThreadCommand(args, options) {
  const { stdout, stderr, platform } = options
  const name = args[0]
  const json = launchJson(args)
  if (name === "--help" || name === "-h") {
    stdout.write(`${USAGE}\n`)
    return THREAD_EXIT.ok
  }
  if (name === undefined || !Object.hasOwn(COMMANDS, name)) {
    refuse(
      options,
      json,
      "invalid_arguments",
      `omo thread: ${name === undefined ? "expects a subcommand" : `unknown subcommand '${name}'`}`,
      "Run omo thread --help.",
    )
    stderr.write(`${USAGE}\n`)
    return THREAD_EXIT.usage
  }
  // Same refusal as `omo daemon` on win32: the gateway's endpoints are unix sockets.
  if (platform === "win32") {
    refuse(
      options,
      json,
      "unsupported",
      "omo thread: a task host needs a unix socket, which win32 does not provide",
      "Run omo thread on macOS or Linux.",
    )
    return THREAD_EXIT.unsupported
  }
  const command = COMMANDS[name]
  const parsed = parseArgs(args.slice(1), {
    booleans: [...COMMON, ...command.booleans],
    values: command.values,
    repeatable: command.repeatable ?? [],
  })
  const problem = parsed.error ?? validate(name, parsed)
  if (problem !== undefined) {
    refuse(
      options,
      json,
      "invalid_arguments",
      `omo thread ${name}: ${problem}`,
      `Run omo thread --help for the ${name} options.`,
    )
    return THREAD_EXIT.usage
  }
  const loaded = await loadThreadSdk(options)
  if (loaded.error !== undefined && loaded.code === "internal_error") {
    // `omo update` installs nothing on an install already at the latest version, so the step is the caller's reinstall.
    refuse(
      options,
      json,
      "internal_error",
      `omo thread: ${loaded.error}`,
      options.reinstall ?? "Reinstall omo, then retry.",
    )
    return THREAD_EXIT.failed
  }
  if (loaded.error !== undefined) {
    refuse(
      options,
      json,
      "unsupported",
      `omo thread: ${loaded.error}`,
      "Run omo thread under bun, or a node with node:sqlite.",
    )
    return THREAD_EXIT.unsupported
  }
  try {
    const scope = parsed.flags.has("--all-scope") ? { all_scope: true } : {}
    const result = await command.call(loaded.sdk, parsed.positionals, parsed.options, scope)
    const exitCode = threadExitCode(result)
    if (result.kind !== "ok") {
      if (json) stdout.write(`${JSON.stringify(result)}\n`)
      stderr.write(
        `omo thread ${name}: ${result.error.code}: ${result.error.message}\n  next: ${result.error.next_action}\n`,
      )
      return exitCode
    }
    if (json) stdout.write(`${JSON.stringify(result)}\n`)
    else for (const line of humanLines(name, result)) stdout.write(`${line}\n`)
    return exitCode
  } finally {
    // The command's result is already printed; a store that fails to close is logged, never a new outcome.
    await loaded.sdk
      .dispose()
      .catch((error) =>
        stderr.write(
          `omo thread: closing the gateway store failed: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      )
  }
}
