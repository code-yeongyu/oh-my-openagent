import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"

import { parseHerdrTabs } from "./nudge.mjs"
import { SCRIPTS_DIR } from "./files.mjs"

/** Read the herdr tab list. A missing binary or a stopped server is reported, never thrown. */
export function readHerdrTabs({ env = process.env, spawn = spawnSync } = {}) {
  const result = spawn(env.OMOMEOW_HERDR_BIN ?? "herdr", ["tab", "list"], { encoding: "utf8", env, timeout: 30000, windowsHide: true })
  if (result.error) return { available: false, error: result.error.code === "ENOENT" ? "herdr not found on PATH" : result.error.message, tabs: [] }
  if (result.status !== 0) return { available: false, error: `herdr tab list exited ${result.status}: ${(result.stderr ?? "").trim().slice(0, 300)}`, tabs: [] }
  return { available: true, error: null, tabs: parseHerdrTabs(result.stdout) }
}

/** Send one message through an agent-messenger bot CLI (`agent-discordbot`, `agent-telegrambot`, ...). */
export function sendMessage(recipient, text, { env = process.env, spawn = spawnSync } = {}) {
  if (typeof recipient?.platform !== "string" || !/^[a-z][a-z0-9]*bot$/.test(recipient.platform)) {
    throw new Error(`recipient platform must be an agent-messenger bot CLI suffix such as discordbot, got ${JSON.stringify(recipient?.platform)}`)
  }
  if (typeof recipient.target !== "string" || recipient.target.length === 0) throw new Error("recipient target is required")
  const args = []
  if (recipient.bot) args.push("--bot", recipient.bot)
  args.push("message", "send", recipient.target, text)
  const result = spawn(`agent-${recipient.platform}`, args, { encoding: "utf8", env, timeout: 60000, windowsHide: true })
  if (result.error) throw new Error(`agent-${recipient.platform}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`agent-${recipient.platform} exited ${result.status}: ${`${result.stderr ?? ""}${result.stdout ?? ""}`.trim().slice(0, 500)}`)
  }
  let messageId = null
  try {
    const parsed = JSON.parse(result.stdout)
    messageId = parsed?.id ?? parsed?.message_id ?? parsed?.ts ?? null
  } catch {
    messageId = null
  }
  return { messageId }
}

export function findOnPath(command, env = process.env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, command)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

export function runtimeScriptsDir(stateDir) {
  return join(stateDir, "runtime", "scripts")
}

function digestTree(root) {
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "tests") continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) hash.update(path.slice(root.length)).update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest("hex")
}

/**
 * The nudge service points at a copy of these scripts under the state dir, so a skill path that moves
 * with every omo update never breaks it. Refresh the copy whenever the shipped scripts differ.
 */
export function syncRuntime(stateDir, { source = SCRIPTS_DIR } = {}) {
  const target = runtimeScriptsDir(stateDir)
  const sourceDigest = digestTree(source)
  const currentDigest = existsSync(target) ? digestTree(target) : null
  if (currentDigest === sourceDigest) return { path: target, changed: false }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true, mode: 0o700 })
  cpSync(source, target, { recursive: true, filter: (path) => !path.slice(source.length).split(/[\\/]/).includes("tests") })
  return { path: target, changed: true }
}

const BOT_CLI = /^agent-([a-z][a-z0-9]*bot)(?:\.(?:cmd|exe))?$/i

/**
 * Signs of a setup done before this skill existed (the old copy-once gist): Herdr and at least one
 * agent-messenger bot CLI on PATH. Reconcile reports them so the agent adopts that setup instead of replaying it.
 */
export function detectExistingSetup(env = process.env) {
  const bots = new Set()
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const match = BOT_CLI.exec(name)
      if (match) bots.add(match[1].toLowerCase())
    }
  }
  const herdr = env.OMOMEOW_HERDR_BIN ? existsSync(env.OMOMEOW_HERDR_BIN) : findOnPath("herdr", env) !== null
  return { herdr, bots: [...bots].sort(), adoptable: herdr && bots.size > 0 }
}
