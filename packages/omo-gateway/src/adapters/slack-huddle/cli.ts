// The huddle surface from a terminal: run it, and drive the call it holds.
//
//   serve   --account <workspace id> --credentials-dir <store> [--port N] [--agent-dir D]
//   status | join --chat <chat id> | leave | capture --on|--off | say-tone [--seconds N] [--hz N]
//
// The client commands read the same 0600 token the surface wrote, so they work only for the operator
// the surface belongs to.

import { homedir } from "node:os"
import { join } from "node:path"
import { syntheticTone } from "./audio"
import { HuddleDriver } from "./driver"
import { serveHuddle } from "./server"
import { loadOrCreateToken, tokenPathFor } from "./token"
import { encodeAudioFrame } from "./wire"

type Flags = Record<string, string | boolean>

function parse(argv: readonly string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = argv
  const flags: Flags = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token === undefined || !token.startsWith("--")) continue
    const name = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true
      continue
    }
    flags[name] = next
    i += 1
  }
  return { command, flags }
}

const text = (flags: Flags, name: string): string | null => (typeof flags[name] === "string" ? flags[name] : null)
const required = (flags: Flags, name: string): string => {
  const value = text(flags, name)
  if (value === null) throw new Error(`--${name} is required`)
  return value
}
const agentDirOf = (flags: Flags): string => text(flags, "agent-dir") ?? process.env.OMO_AGENT_DIR ?? join(homedir(), ".omo", "agent")
const portPath = (agentDir: string): string => join(agentDir, "gateway", "huddle", "port")

async function serve(flags: Flags): Promise<number> {
  const agentDir = agentDirOf(flags)
  const token = loadOrCreateToken(tokenPathFor(agentDir))
  const driver = new HuddleDriver({
    account_id: required(flags, "account"),
    session: await sessionFrom(flags),
    profilesRoot: join(agentDir, "gateway", "huddle", "profiles"),
    ...(flags["capture-humans"] === true ? { onHumanJoin: "continue" as const } : {}),
    ...(text(flags, "control-ready-ms") === null ? {} : { controlReadyMs: Number(text(flags, "control-ready-ms")) }),
    ...(text(flags, "join-timeout-ms") === null ? {} : { joinTimeoutMs: Number(text(flags, "join-timeout-ms")) }),
  })
  const port = text(flags, "port")
  const server = serveHuddle({ driver, token, ...(port === null ? {} : { port: Number(port) }) })
  await Bun.write(portPath(agentDir), String(server.port))
  console.log(`huddle surface on ${server.url} (token in ${tokenPathFor(agentDir)})`)
  const stop = async (): Promise<void> => {
    await driver.close()
    await server.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => void stop())
  process.on("SIGTERM", () => void stop())
  await new Promise(() => undefined)
  return 0
}

/**
 * Credentials come from the connector's own custody-checked store, never from a flag: the same
 * refusal applies here as for a text surface if other local users could read them.
 */
async function sessionFrom(flags: Flags): Promise<{ token: string; cookie: string }> {
  const { loadSlackSecrets } = await import("../slack/connect")
  const { resolveCredentials } = await import("../../connector/credentials")
  const surface = { platform: "slack" as const, account_id: required(flags, "account"), credentials_dir: required(flags, "credentials-dir") }
  const secrets = await loadSlackSecrets({ scope: "huddle", surface, credentials: await resolveCredentials(surface, { env: process.env, home: homedir() }) })
  if (secrets.cookie === undefined) throw new Error("a huddle needs a member session (token and cookie), not an app token")
  return { token: secrets.token, cookie: secrets.cookie }
}

async function callSurface(flags: Flags, path: string, init: RequestInit = {}): Promise<unknown> {
  const agentDir = agentDirOf(flags)
  const token = loadOrCreateToken(tokenPathFor(agentDir))
  const port = text(flags, "port") ?? (await Bun.file(portPath(agentDir)).text()).trim()
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${JSON.stringify(body)}`)
  return body
}

export async function main(argv: readonly string[]): Promise<number> {
  const { command, flags } = parse(argv)
  switch (command) {
    case "serve":
      return await serve(flags)
    case "status":
      console.log(JSON.stringify(await callSurface(flags, "/status"), null, 2))
      return 0
    case "stats":
      console.log(JSON.stringify(await callSurface(flags, "/stats"), null, 2))
      return 0
    case "join":
      console.log(JSON.stringify(await callSurface(flags, "/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: required(flags, "chat") }) }), null, 2))
      return 0
    case "leave":
      console.log(JSON.stringify(await callSurface(flags, "/leave", { method: "POST" }), null, 2))
      return 0
    case "capture":
      console.log(JSON.stringify(await callSurface(flags, "/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: flags.off !== true }) }), null, 2))
      return 0
    case "say-tone": {
      const seconds = Number(text(flags, "seconds") ?? "3")
      const hz = Number(text(flags, "hz") ?? "440")
      const pcm16 = syntheticTone({ seconds, hz, sample_rate: 48000, amplitude: 0.3 })
      const body = encodeAudioFrame({ direction: "outbound", sample_rate: 48000, at_ms: Date.now(), speaker: null, pcm16 })
      console.log(JSON.stringify(await callSurface(flags, "/speak", { method: "POST", body }), null, 2))
      return 0
    }
    default:
      console.log("commands: serve, status, stats, join --chat <id>, leave, capture [--off], say-tone [--seconds N] [--hz N]")
      return command === "help" ? 0 : 1
  }
}

if (import.meta.main) {
  // no-excuse-ok: catch - the CLI boundary turns any failure into an exit code
  try {
    process.exit(await main(Bun.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
