import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { print, UsageError } from "./cli-context.mjs"
import { loadOmoMeowSettings } from "./config.mjs"
import { forgetFeature, hasPendingWork, normalizeState, planReconcile, recordFeature, validateManifest } from "./features.mjs"
import { readJson, SKILL_DIR, writeJsonAtomic } from "./files.mjs"
import { nudgeServiceStatus } from "./service.mjs"
import { detectExistingSetup, runtimeScriptsDir, syncRuntime } from "./system.mjs"

function loadManifest(path) {
  return validateManifest(JSON.parse(readFileSync(path ?? join(SKILL_DIR, "manifest.json"), "utf8")))
}

export function loadState(ctx) {
  return normalizeState(readJson(ctx.statePath, null))
}

export function loadSessions(ctx) {
  const raw = readJson(ctx.sessionsPath, { sessions: {} })
  return { sessions: raw?.sessions ?? {} }
}

function recipientFrom(values, fallback) {
  if (values.platform === undefined && values.target === undefined) return fallback
  if (!values.platform || !values.target) throw new UsageError("--platform and --target go together")
  return { platform: values.platform, target: values.target, ...(values.bot ? { bot: values.bot } : {}) }
}

export function reconcileCommand(ctx, values) {
  const manifest = loadManifest(values.manifest)
  const { settings, sources, diagnostics } = loadOmoMeowSettings({ cwd: ctx.cwd, env: ctx.env })
  const state = loadState(ctx)
  const plan = planReconcile({ manifest, state, settings })
  // A setup done by hand before this skill (the old gist) is adopted, not replayed: report what is already there.
  plan.install = plan.install.map((entry) => (entry.id === "setup" ? { ...entry, existing: detectExistingSetup(ctx.env) } : entry))
  // Keep the nudge service's script copy in step with this skill version once a service uses it.
  const runtime = existsSync(runtimeScriptsDir(ctx.stateDir)) ? syncRuntime(ctx.stateDir) : null
  print({ stateDir: ctx.stateDir, pending: hasPendingWork(plan), ...plan, runtime, owner: state.owner, settings, configSources: sources, diagnostics })
  return 0
}

export function recordCommand(ctx, values, [id]) {
  if (!id) throw new UsageError("record needs a feature id")
  let data = {}
  if (values.data !== undefined) {
    try {
      data = JSON.parse(values.data)
    } catch (error) {
      throw new UsageError(`--data is not JSON: ${error.message}`)
    }
  }
  const manifest = loadManifest(values.manifest)
  const { settings } = loadOmoMeowSettings({ cwd: ctx.cwd, env: ctx.env })
  const next = recordFeature({ manifest, state: loadState(ctx), settings, id, data })
  writeJsonAtomic(ctx.statePath, next)
  print({ recorded: id, feature: next.features[id] })
  return 0
}

export function forgetCommand(ctx, _values, [id]) {
  if (!id) throw new UsageError("forget needs a feature id")
  writeJsonAtomic(ctx.statePath, forgetFeature({ state: loadState(ctx), id }))
  print({ forgotten: id })
  return 0
}

export function statusCommand(ctx) {
  const { settings, sources, diagnostics } = loadOmoMeowSettings({ cwd: ctx.cwd, env: ctx.env })
  print({
    stateDir: ctx.stateDir,
    state: loadState(ctx),
    settings,
    configSources: sources,
    diagnostics,
    sessions: Object.keys(loadSessions(ctx).sessions).length,
    service: { ...nudgeServiceStatus({ env: ctx.env }), runtime: runtimeScriptsDir(ctx.stateDir) },
  })
  return 0
}

export function ownerCommand(ctx, values, [action]) {
  const state = loadState(ctx)
  if (action === "show") {
    print({ owner: state.owner })
    return 0
  }
  if (action !== "set") throw new UsageError("owner set|show")
  const owner = recipientFrom(values, null)
  if (owner === null) throw new UsageError("owner set needs --platform and --target")
  writeJsonAtomic(ctx.statePath, { ...state, owner })
  print({ owner })
  return 0
}

export function sessionCommand(ctx, values, [action, tab, ...text]) {
  const store = loadSessions(ctx)
  if (action === "list") {
    print(store)
    return 0
  }
  if (!["set", "progress", "close"].includes(action)) throw new UsageError("session set|progress|close|list")
  if (!tab) throw new UsageError(`session ${action} needs a herdr tab id`)
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
    if (!store.sessions[tab]) throw new UsageError(`tab ${tab} is not in the session map; run session set first`)
    store.sessions[tab] = { ...store.sessions[tab], progress: text.join(" "), progressAt: now }
  } else {
    delete store.sessions[tab]
  }
  writeJsonAtomic(ctx.sessionsPath, store)
  print({ tab, session: store.sessions[tab] ?? null })
  return 0
}
