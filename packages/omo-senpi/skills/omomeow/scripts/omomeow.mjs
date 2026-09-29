#!/usr/bin/env node
// omomeow skill CLI: the deterministic half of OmOMeow mode (reconcile state, session map, nudge,
// schedule hook, runner service). Node or Bun, `node:*` built-ins only. Every command prints JSON.
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { parseArgs } from "node:util"

import { loadOmoMeowSettings } from "./lib/config.mjs"
import { forgetFeature, hasPendingWork, normalizeState, planReconcile, recordFeature, validateManifest } from "./lib/features.mjs"
import { CLI_PATH, readJson, resolveAgentDir, resolveStateDir, SKILL_DIR, writeJsonAtomic } from "./lib/files.mjs"
import { buildItems, formatNudge, NUDGE_MARKER, planNudge, trackTabs } from "./lib/nudge.mjs"
import {
  buildRunnerSpec,
  findOnPath,
  installRunnerService,
  readHerdrTabs,
  readRunnerLeases,
  renderLaunchdPlist,
  renderSystemdUnit,
  runtimeScriptsDir,
  sendMessage,
  serviceFilePath,
  syncRuntime,
  uninstallRunnerService,
} from "./lib/system.mjs"

const USAGE = `usage: omomeow.mjs <command>
  reconcile [--manifest <path>]           what to install, update, or remove for this user
  record <feature> [--data <json>]        mark a feature installed (manifest version + current config)
  forget <feature>                        mark a feature removed
  status                                  state, config, and runner summary
  owner set --platform <p> --target <id> [--bot <id>] | owner show
  session set <tab> [--title t] [--thread t] [--session-id id] [--started-at iso]
                    [--platform p --target id [--bot id]]  (requester; defaults to the owner)
  session progress <tab> <text> | session close <tab> | session list
  snapshot                                herdr tabs and the items a nudge would report (no writes)
  nudge [--dry-run]                       send the overview DM when something runs and changed
  nudge-prompt                            the exact schedule_prompt text for the nudge job
  schedule-hook                           --exec target for \`senpi schedule run\` (job JSON on stdin)
  runner status|render|install|uninstall [--senpi-bin <path>] [--agent-dir <dir>]
                                          (render refreshes the runtime copy and prints the service)`

const env = process.env
const stateDir = resolveStateDir(env)
const statePath = join(stateDir, "state.json")
const sessionsPath = join(stateDir, "sessions.json")
const nudgeStatePath = join(stateDir, "nudge.json")

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function fail(message, code = 2) {
  process.stderr.write(`omomeow: ${message}\n`)
  process.exit(code)
}

function loadManifest(path) {
  return validateManifest(JSON.parse(readFileSync(path ?? join(SKILL_DIR, "manifest.json"), "utf8")))
}

function loadState() {
  return normalizeState(readJson(statePath, null))
}

function loadSessions() {
  const raw = readJson(sessionsPath, { sessions: {} })
  return { sessions: raw?.sessions ?? {} }
}

function recipientFrom(values, fallback) {
  if (values.platform === undefined && values.target === undefined) return fallback
  if (!values.platform || !values.target) fail("--platform and --target go together")
  return { platform: values.platform, target: values.target, ...(values.bot ? { bot: values.bot } : {}) }
}

function runnerSummary(agentDir) {
  const leases = readRunnerLeases(agentDir).filter((lease) => lease.alive)
  return {
    agentDir,
    live: leases.length,
    ours: leases.some((lease) => lease.ours),
    others: leases.filter((lease) => !lease.ours).map(({ pid, exec }) => ({ pid, exec })),
    serviceFile: serviceFilePath(process.platform, env),
    serviceInstalled: existsSync(serviceFilePath(process.platform, env) ?? "/nonexistent"),
    runtime: runtimeScriptsDir(stateDir),
  }
}

function runNudge({ cwd, dryRun }) {
  const { settings, diagnostics } = loadOmoMeowSettings({ cwd, env })
  if (!settings.nudge.enabled) return { event: "nudge", sent: [], reason: "disabled", diagnostics }
  const herdr = readHerdrTabs({ env })
  if (!herdr.available) return { event: "nudge", sent: [], reason: "herdr_unavailable", error: herdr.error, diagnostics }
  const now = Date.now()
  const state = loadState()
  const { sessions } = loadSessions()
  const previous = readJson(nudgeStatePath, { tabs: {}, sent: {} })
  const tracked = trackTabs(previous.tabs ?? {}, herdr.tabs, now)
  const items = buildItems({ tabs: herdr.tabs, tracked, sessions })
  const plan = planNudge({ items, owner: state.owner, sent: previous.sent ?? {} })
  const sent = []
  const failed = []
  const nextSent = { ...(previous.sent ?? {}) }
  for (const delivery of plan.deliveries) {
    const text = formatNudge(delivery.items, { now, language: settings.language })
    if (dryRun) {
      sent.push({ recipient: delivery.key, items: delivery.items.length, text, dryRun: true })
      continue
    }
    try {
      const { messageId } = sendMessage(delivery.recipient, text, { env })
      nextSent[delivery.key] = { fingerprint: delivery.fingerprint, sentAt: new Date(now).toISOString(), messageId }
      sent.push({ recipient: delivery.key, items: delivery.items.length, messageId })
    } catch (error) {
      failed.push({ recipient: delivery.key, error: error.message })
    }
  }
  if (!dryRun) writeJsonAtomic(nudgeStatePath, { tabs: tracked, sent: nextSent })
  return {
    event: "nudge",
    tabs: herdr.tabs.length,
    items: items.length,
    sent,
    failed,
    skipped: plan.skipped,
    unroutable: plan.unroutable,
    reason: sent.length > 0 ? null : failed.length > 0 ? "send_failed" : plan.unroutable.length > 0 && plan.deliveries.length === 0 && plan.skipped.length === 0 ? "no_owner" : plan.reason,
    diagnostics,
  }
}

function nudgePrompt() {
  const runtimeCli = join(runtimeScriptsDir(stateDir), "omomeow.mjs")
  const cli = existsSync(runtimeCli) ? runtimeCli : CLI_PATH
  return `${NUDGE_MARKER} OmOMeow periodic nudge. The omomeow schedule hook normally handles this job without a model turn. If you are reading this, run \`node '${cli}' nudge\` once and reply with its JSON line only; send nothing else.`
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

async function scheduleHook() {
  const job = JSON.parse(await readStdin())
  if (typeof job.prompt === "string" && job.prompt.startsWith(NUDGE_MARKER)) {
    const result = runNudge({ cwd: job.cwd && existsSync(job.cwd) ? job.cwd : process.cwd(), dryRun: false })
    const line = { ...result, job: job.id, occurrence: job.fireCount ?? null, at: new Date().toISOString() }
    // The runner does not keep hook output, so each scheduled nudge leaves one line here.
    mkdirSync(join(stateDir, "logs"), { recursive: true, mode: 0o700 })
    appendFileSync(join(stateDir, "logs", "nudge.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 })
    print(line)
    return result.failed?.length > 0 ? 1 : 0
  }
  // Any other scheduled prompt keeps senpi's default delivery: resume the session headlessly.
  const senpiBin = env.OMOMEOW_SENPI_BIN ?? "senpi"
  const session = job.sessionFile ?? job.sessionId
  const result = spawnSync(senpiBin, ["-p", "--session", session, job.message ?? job.prompt], {
    cwd: job.cwd && existsSync(job.cwd) ? job.cwd : process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.error) {
    process.stderr.write(`omomeow: default delivery via ${senpiBin} failed: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

function resolveSenpiBin(values, agentDir) {
  if (values["senpi-bin"]) return values["senpi-bin"]
  if (env.OMOMEOW_SENPI_BIN) return env.OMOMEOW_SENPI_BIN
  const preferOmo = agentDir.endsWith(join(".omo", "agent"))
  const found = (preferOmo ? findOnPath("omo", env) : null) ?? findOnPath("senpi", env) ?? findOnPath("omo", env)
  if (found === null) fail("cannot find senpi or omo on PATH; pass --senpi-bin")
  return found
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string" },
      data: { type: "string" },
      platform: { type: "string" },
      target: { type: "string" },
      bot: { type: "string" },
      title: { type: "string" },
      thread: { type: "string" },
      "session-id": { type: "string" },
      "started-at": { type: "string" },
      "dry-run": { type: "boolean" },
      "senpi-bin": { type: "string" },
      "agent-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  })
  const [command, ...rest] = positionals
  if (values.help || command === undefined) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  switch (command) {
    case "reconcile": {
      const manifest = loadManifest(values.manifest)
      const { settings, sources, diagnostics } = loadOmoMeowSettings({ cwd: process.cwd(), env })
      const state = loadState()
      const plan = planReconcile({ manifest, state, settings })
      // Keep the runner's script copy in step with this skill version once a runner uses it.
      const runtime = existsSync(runtimeScriptsDir(stateDir)) ? syncRuntime(stateDir) : null
      print({ stateDir, pending: hasPendingWork(plan), ...plan, runtime, owner: state.owner, settings, configSources: sources, diagnostics })
      return 0
    }
    case "record": {
      const id = rest[0] ?? fail("record needs a feature id")
      let data = {}
      if (values.data !== undefined) {
        try {
          data = JSON.parse(values.data)
        } catch (error) {
          fail(`--data is not JSON: ${error.message}`)
        }
      }
      const manifest = loadManifest(values.manifest)
      const { settings } = loadOmoMeowSettings({ cwd: process.cwd(), env })
      const next = recordFeature({ manifest, state: loadState(), settings, id, data })
      writeJsonAtomic(statePath, next)
      print({ recorded: id, feature: next.features[id] })
      return 0
    }
    case "forget": {
      const id = rest[0] ?? fail("forget needs a feature id")
      writeJsonAtomic(statePath, forgetFeature({ state: loadState(), id }))
      print({ forgotten: id })
      return 0
    }
    case "status": {
      const state = loadState()
      const { settings, sources, diagnostics } = loadOmoMeowSettings({ cwd: process.cwd(), env })
      print({ stateDir, state, settings, configSources: sources, diagnostics, sessions: Object.keys(loadSessions().sessions).length, runner: runnerSummary(resolveAgentDir(env)) })
      return 0
    }
    case "owner": {
      const state = loadState()
      if (rest[0] === "show") {
        print({ owner: state.owner })
        return 0
      }
      if (rest[0] !== "set") fail("owner set|show")
      const owner = recipientFrom(values, null) ?? fail("owner set needs --platform and --target")
      writeJsonAtomic(statePath, { ...state, owner })
      print({ owner })
      return 0
    }
    case "session": {
      const [action, tab, ...text] = rest
      const store = loadSessions()
      if (action === "list") {
        print(store)
        return 0
      }
      if (!tab) fail(`session ${action ?? "<action>"} needs a herdr tab id`)
      const now = new Date().toISOString()
      if (action === "set") {
        const before = store.sessions[tab] ?? {}
        const requester = recipientFrom(values, before.requester ?? null)
        store.sessions[tab] = {
          ...before,
          ...(values.title !== undefined ? { title: values.title } : {}),
          ...(values.thread !== undefined ? { thread: values.thread } : {}),
          ...(values["session-id"] !== undefined ? { sessionId: values["session-id"] } : {}),
          ...(requester ? { requester } : {}),
          startedAt: values["started-at"] ?? before.startedAt ?? now,
        }
      } else if (action === "progress") {
        if (!store.sessions[tab]) fail(`tab ${tab} is not in the session map; run session set first`)
        store.sessions[tab] = { ...store.sessions[tab], progress: text.join(" "), progressAt: now }
      } else if (action === "close") {
        delete store.sessions[tab]
      } else {
        fail("session set|progress|close|list")
      }
      writeJsonAtomic(sessionsPath, store)
      print({ tab, session: store.sessions[tab] ?? null })
      return 0
    }
    case "snapshot": {
      const herdr = readHerdrTabs({ env })
      const previous = readJson(nudgeStatePath, { tabs: {} })
      const tracked = trackTabs(previous.tabs ?? {}, herdr.tabs, Date.now())
      print({ herdr: { available: herdr.available, error: herdr.error }, tabs: herdr.tabs, items: buildItems({ tabs: herdr.tabs, tracked, sessions: loadSessions().sessions }) })
      return 0
    }
    case "nudge": {
      const result = runNudge({ cwd: process.cwd(), dryRun: values["dry-run"] === true })
      print(result)
      return result.failed?.length > 0 ? 1 : 0
    }
    case "nudge-prompt": {
      print({ prompt: nudgePrompt() })
      return 0
    }
    case "schedule-hook":
      return scheduleHook()
    case "runner": {
      const agentDir = values["agent-dir"] ?? resolveAgentDir(env)
      const action = rest[0]
      if (action === "status") {
        print(runnerSummary(agentDir))
        return 0
      }
      if (action === "uninstall") {
        print(uninstallRunnerService({ env }))
        return 0
      }
      if (action !== "render" && action !== "install") fail("runner status|render|install|uninstall")
      // Prefer the PATH entry (e.g. /opt/homebrew/bin/node) over process.execPath, which can be a
      // versioned install dir that disappears on the next runtime upgrade.
      const runtimeName = basename(process.execPath).replace(/\.exe$/i, "")
      const nodeBin = findOnPath(runtimeName, env) ?? process.execPath
      const spec = buildRunnerSpec({ senpiBin: resolveSenpiBin(values, agentDir), agentDir, stateDir, nodeBin, env })
      // Both actions need the runtime copy the hook command points at (render is how users on other
      // platforms get a command line for their own supervisor).
      const runtime = syncRuntime(stateDir)
      if (action === "render") {
        const file = process.platform === "darwin" ? renderLaunchdPlist(spec) : renderSystemdUnit(spec)
        print({ runtime, spec, serviceFile: serviceFilePath(process.platform, env), file })
        return 0
      }
      const others = readRunnerLeases(agentDir).filter((lease) => lease.alive && !lease.ours)
      const installed = installRunnerService({ spec, env })
      print({ runtime, ...installed, spec, otherLiveRunners: others.map(({ pid, exec }) => ({ pid, exec })) })
      return installed.steps.some((step) => step.required && (step.error !== null || step.status !== 0)) ? 1 : 0
    }
    default:
      fail(`unknown command ${command}\n${USAGE}`)
  }
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => fail(error.message, 1),
)
