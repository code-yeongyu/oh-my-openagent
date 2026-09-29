import { userInfo } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { integerOption, parseArgs, THREAD_EXIT } from "./thread-args.js"
import { humanLines } from "./thread-output.js"

export { THREAD_EXIT } from "./thread-args.js"

/**
 * `omo thread` - the session gateway for scripts and connectors: every thread operation the agent
 * tools offer, run through the plugin's thread SDK (`plugin/runtime/thread-sdk/sdk.js`) as
 * `cli:<uid>`. It never starts a host: sessions are listed from what the engine enumerates, and
 * bindings, the outbox and receipts live in the gateway store. JSON shapes: docs/reference/omo-thread.md.
 */

const USAGE = [
  "usage: omo thread <list|send|read|bind|unbind|rebind|bindings|report|answer|outbox|ack> [options] [--json]",
  "",
  "  list      [--all-scope]",
  "  send      <target> <text> [--mode auto|steer|follow_up] [--expected-turn <n>] [--idempotency-key <k>]",
  "  send      --binding <id> [<target>] <text> [--idempotency-key <event-id>]",
  "  read      <target> [--limit <items>] [--max-bytes <n>] [--cursor <c>]",
  "  bind      <session> --platform <p> --account <id> --chat <id> [--thread <id>] [--root-message <id>]",
  "            [--progress-message <id>] [--direction in|out|both] [--inbound-mode auto|follow_up]",
  "            [--events <kind,...>] [--policy <id>] [--ttl <seconds>|none] [--idempotency-key <k>]",
  "  unbind    <binding-id> --revision <n> [--idempotency-key <k>]",
  "  rebind    <binding-id> <session> --revision <n> [--idempotency-key <k>]",
  "  bindings  [--session <s>] [--platform <p>] [--account <id>] [--chat <id>] [--thread <id>] [--status <s>] [--cursor <c>] [--limit <n>]",
  "  report    <session> <milestone|report|question|completion> <text> [--binding <id>] [--request-id <id>] [--idempotency-key <k>]",
  "  answer    --binding <answering-binding-id> --token <reply-token> <text>",
  "  outbox    <binding-id> [--after <cursor>] [--limit <n>] [--ack]",
  "  ack       <binding-id> <cursor> [--provider-message-id <id>]",
  "",
  "  --all-scope  resolve sessions in every workspace, not only this directory's",
  "  --json       print the result as one JSON value",
].join("\n")

const COMMON = ["--json", "--all-scope"]

const COMMANDS = {
  list: { values: [], booleans: [], arity: [0, 0], call: (sdk, _p, _o, scope) => sdk.list(scope) },
  send: {
    values: ["--mode", "--expected-turn", "--binding", "--idempotency-key"],
    booleans: [],
    arity: [1, 2],
    call: (sdk, p, o, scope) => sdk.send({ ...scope, ...sendTarget(p, o), mode: o["--mode"], expected_turn_id: integerOption(o, "--expected-turn"), binding_id: o["--binding"], idempotency_key: o["--idempotency-key"] }),
  },
  read: {
    values: ["--limit", "--max-bytes", "--cursor"],
    booleans: [],
    arity: [1, 1],
    call: async (sdk, p, o, scope) => lastItems(await sdk.read({ ...scope, thread: p[0], max_bytes: integerOption(o, "--max-bytes"), cursor: o["--cursor"] }), integerOption(o, "--limit")),
  },
  bind: {
    values: ["--platform", "--account", "--chat", "--thread", "--root-message", "--progress-message", "--direction", "--inbound-mode", "--events", "--policy", "--ttl", "--idempotency-key"],
    booleans: [],
    arity: [1, 1],
    call: (sdk, p, o, scope) => sdk.bind({ ...scope, session: p[0], idempotency_key: o["--idempotency-key"], binding: bindingInput(o) }),
  },
  unbind: { values: ["--revision", "--idempotency-key"], booleans: [], arity: [1, 1], call: (sdk, p, o) => sdk.unbind({ binding_id: p[0], expected_revision: integerOption(o, "--revision"), idempotency_key: o["--idempotency-key"] }) },
  rebind: { values: ["--revision", "--idempotency-key"], booleans: [], arity: [2, 2], call: (sdk, p, o, scope) => sdk.rebind({ ...scope, binding_id: p[0], session: p[1], expected_revision: integerOption(o, "--revision"), idempotency_key: o["--idempotency-key"] }) },
  bindings: {
    values: ["--session", "--platform", "--account", "--chat", "--thread", "--status", "--cursor", "--limit"],
    booleans: [],
    arity: [0, 0],
    call: (sdk, _p, o, scope) => sdk.bindings({ ...scope, session: o["--session"], platform: o["--platform"], account_id: o["--account"], chat_id: o["--chat"], thread_id: o["--thread"], status: o["--status"], cursor: o["--cursor"], limit: integerOption(o, "--limit") }),
  },
  report: {
    values: ["--binding", "--request-id", "--idempotency-key"],
    booleans: [],
    arity: [3, 3],
    call: (sdk, p, o, scope) => sdk.report({ ...scope, session: p[0], kind: p[1], text: p[2], binding_id: o["--binding"], request_id: o["--request-id"], idempotency_key: o["--idempotency-key"] }),
  },
  answer: { values: ["--binding", "--token"], booleans: [], arity: [1, 1], call: (sdk, p, o) => sdk.answer({ binding_id: o["--binding"], reply_token: o["--token"], answer: p[0] }) },
  outbox: { values: ["--after", "--limit"], booleans: ["--ack"], arity: [1, 1], call: (sdk, p, o, _scope, flags) => drainOutbox(sdk, p[0], o, flags.has("--ack")) },
  ack: { values: ["--provider-message-id"], booleans: [], arity: [2, 2], call: (sdk, p, o) => sdk.ack({ binding_id: p[0], cursor: Number(p[1]), provider_message_id: o["--provider-message-id"] }) },
}

const REQUIRED = { unbind: ["--revision"], rebind: ["--revision"], bind: ["--platform", "--account", "--chat"], answer: ["--binding", "--token"] }
const INTEGER_FLAGS = ["--expected-turn", "--limit", "--max-bytes", "--revision", "--after"]
const CHOICE_FLAGS = { "--mode": ["auto", "steer", "follow_up"], "--direction": ["in", "out", "both"] }

function sendTarget(positionals, options) {
  if (positionals.length === 2) return { thread: positionals[0], text: positionals[1] }
  return options["--binding"] === undefined ? { thread: positionals[0], text: undefined } : { text: positionals[0] }
}

function bindingInput(o) {
  const direction = o["--direction"] === undefined ? undefined : { inbound: o["--direction"] !== "out", outbound: o["--direction"] !== "in" }
  const ttl = o["--ttl"] === undefined ? undefined : o["--ttl"] === "none" ? null : Number(o["--ttl"])
  return {
    platform: o["--platform"],
    account_id: o["--account"],
    chat_id: o["--chat"],
    thread_id: o["--thread"],
    root_message_id: o["--root-message"],
    progress_message_id: o["--progress-message"],
    direction,
    inbound_mode: o["--inbound-mode"],
    outbound_events: o["--events"]?.split(",").filter(Boolean),
    policy_id: o["--policy"],
    ttl_seconds: ttl,
  }
}

function lastItems(result, limit) {
  if (limit === undefined || result.kind !== "ok") return result
  return { ...result, items: result.items.slice(Math.max(0, result.items.length - limit)) }
}

/** The connector drain: read a page, and with `--ack` acknowledge through its newest row. */
async function drainOutbox(sdk, bindingId, options, ack) {
  const page = await sdk.outbox({ binding_id: bindingId, after_cursor: integerOption(options, "--after"), limit: integerOption(options, "--limit") })
  if (!ack || page.kind !== "ok") return page
  const newest = page.rows.at(-1)
  if (newest === undefined) return { ...page, acked: null }
  const acked = await sdk.ack({ binding_id: bindingId, cursor: newest.cursor })
  return acked.kind === "ok" ? { ...page, acked } : acked
}

function validate(name, parsed) {
  const [min, max] = COMMANDS[name].arity
  const count = parsed.positionals.length
  if (count < min || count > max) return `expects ${min === max ? min : `${min}-${max}`} argument(s), got ${count}`
  for (const flag of REQUIRED[name] ?? []) if (parsed.options[flag] === undefined) return `${flag} is required`
  for (const flag of INTEGER_FLAGS) if (Number.isNaN(integerOption(parsed.options, flag) ?? 0)) return `${flag} must be a non-negative integer`
  for (const [flag, choices] of Object.entries(CHOICE_FLAGS)) {
    const value = parsed.options[flag]
    if (value !== undefined && !choices.includes(value)) return `${flag} must be one of ${choices.join(", ")}, got '${value}'`
  }
  if (name === "send") {
    const binding = parsed.options["--binding"] !== undefined
    if (!binding && count !== 2) return "needs <target> <text> (or --binding <id>)"
    if (parsed.positionals.at(-1).trim() === "") return "<text> is empty"
    if (binding && (parsed.options["--mode"] !== undefined || parsed.options["--expected-turn"] !== undefined)) return "--binding delivers with the binding's inbound mode; drop --mode/--expected-turn"
  }
  if (name === "ack" && !/^\d+$/.test(parsed.positionals[1])) return "<cursor> must be a non-negative integer"
  return undefined
}

/** With `--json`, a failure the CLI answers itself is printed in the SDK's error shape, so stdout is always one JSON value. */
function refuse({ stdout, stderr }, json, code, line, nextAction) {
  if (json) stdout.write(`${JSON.stringify({ kind: "error", error: { code, message: line, next_action: nextAction } })}\n`)
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
 */
export async function loadThreadSdk({ pluginRoot, agentDir, env, cwd, engine, loadSqlite, importSdk, identity }) {
  try {
    await (loadSqlite ?? (() => import("node:sqlite")))()
  } catch {
    return { error: `node:sqlite is unavailable in this runtime (${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`}); the session gateway store needs it` }
  }
  const module = await (importSdk ?? (() => import(pathToFileURL(join(pluginRoot, "runtime", "thread-sdk", "sdk.js")).href)))()
  const who = identity ?? { uid: process.getuid?.() ?? 0, user: userInfo().username }
  const engineStatusAll = async () => engine.run(["host", "status", "--json", "--all", "--include-workers"], { env: { ...env, OMO_AGENT_DIR: agentDir } }).stdout
  return { sdk: module.createThreadSdk({ agentDir, cwd, uid: who.uid, user: who.user, env, engineStatusAll }) }
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
    refuse(options, json, "invalid_arguments", `omo thread: ${name === undefined ? "expects a subcommand" : `unknown subcommand '${name}'`}`, "Run omo thread --help.")
    stderr.write(`${USAGE}\n`)
    return THREAD_EXIT.usage
  }
  // Same refusal as `omo daemon` on win32: the gateway's endpoints are unix sockets.
  if (platform === "win32") {
    refuse(options, json, "unsupported", "omo thread: a task host needs a unix socket, which win32 does not provide", "Run omo thread on macOS or Linux.")
    return THREAD_EXIT.unsupported
  }
  const command = COMMANDS[name]
  const parsed = parseArgs(args.slice(1), { booleans: [...COMMON, ...command.booleans], values: command.values })
  const problem = parsed.error ?? validate(name, parsed)
  if (problem !== undefined) {
    refuse(options, json, "invalid_arguments", `omo thread ${name}: ${problem}`, `Run omo thread --help for the ${name} options.`)
    return THREAD_EXIT.usage
  }
  const loaded = await loadThreadSdk(options)
  if (loaded.error !== undefined) {
    refuse(options, json, "unsupported", `omo thread: ${loaded.error}`, "Run omo thread under bun, or a node with node:sqlite.")
    return THREAD_EXIT.unsupported
  }
  try {
    const scope = parsed.flags.has("--all-scope") ? { all_scope: true } : {}
    const result = await command.call(loaded.sdk, parsed.positionals, parsed.options, scope, parsed.flags)
    const exitCode = threadExitCode(result)
    if (result.kind !== "ok") {
      if (json) stdout.write(`${JSON.stringify(result)}\n`)
      stderr.write(`omo thread ${name}: ${result.error.code}: ${result.error.message}\n  next: ${result.error.next_action}\n`)
      return exitCode
    }
    if (json) stdout.write(`${JSON.stringify(name === "list" ? result.threads : result)}\n`)
    else for (const line of humanLines(name, result)) stdout.write(`${line}\n`)
    return exitCode
  } finally {
    await loaded.sdk.dispose()
  }
}

