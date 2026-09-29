// Live proof for the huddle voice surface, against a surface already running locally.
//
//   bun src/adapters/slack-huddle/qa.ts --chat <chat id> [--agent-dir D] [--seconds 3]
//
// It joins one call, injects a synthetic tone, reads the media counters either side of it, and
// leaves. The audio is generated here: this script never records anyone, and never writes audio to
// disk. Run it only against the agreed QA chat.

import { homedir } from "node:os"
import { join } from "node:path"
import { syntheticTone } from "./audio"
import { loadOrCreateToken, tokenPathFor } from "./token"
import { encodeAudioFrame } from "./wire"

type Flags = Record<string, string | undefined>

const parse = (argv: readonly string[]): Flags => {
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined || !token.startsWith("--")) continue
    const next = argv[i + 1]
    flags[token.slice(2)] = next === undefined || next.startsWith("--") ? "true" : next
    if (next !== undefined && !next.startsWith("--")) i += 1
  }
  return flags
}

const packetsSent = (stats: unknown): number => {
  if (typeof stats !== "object" || stats === null) return 0
  const outbound = "stats" in stats ? (stats as { stats?: { outbound?: { packetsSent?: number } } }).stats?.outbound : undefined
  return typeof outbound?.packetsSent === "number" ? outbound.packetsSent : 0
}

async function main(argv: readonly string[]): Promise<number> {
  const flags = parse(argv)
  const chat = flags.chat
  if (chat === undefined) throw new Error("--chat <chat id> is required")
  const agentDir = flags["agent-dir"] ?? process.env.OMO_AGENT_DIR ?? join(homedir(), ".omo", "agent")
  const seconds = Number(flags.seconds ?? "3")
  const token = loadOrCreateToken(tokenPathFor(agentDir))
  const port = (await Bun.file(join(agentDir, "gateway", "huddle", "port")).text()).trim()
  const base = `http://127.0.0.1:${port}`
  const auth = { authorization: `Bearer ${token}` }

  const events: unknown[] = []
  const socket = new WebSocket(`ws://127.0.0.1:${port}/stream`, [`omo-huddle.${token}`])
  socket.binaryType = "arraybuffer"
  let audioBlocks = 0
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      events.push(JSON.parse(event.data))
      return
    }
    audioBlocks += 1
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve())
    socket.addEventListener("error", () => reject(new Error("the stream refused the connection")))
  })

  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } })
    const body: unknown = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${path} answered ${response.status}: ${JSON.stringify(body)}`)
    return body
  }

  const before_status = await call("/status")
  const joined = await call("/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat }) })
  const stats_before = await call("/stats")
  const tone = syntheticTone({ seconds, hz: 440, sample_rate: 48000, amplitude: 0.3 })
  const spoke = await call("/speak", { method: "POST", body: encodeAudioFrame({ direction: "outbound", sample_rate: 48000, at_ms: Date.now(), speaker: null, pcm16: tone }) })
  const stats_after = await call("/stats")
  const in_call_status = await call("/status")
  const left = await call("/leave", { method: "POST" })
  socket.close()

  console.log(
    JSON.stringify(
      {
        before_status,
        joined,
        spoke,
        stats_before,
        stats_after,
        packets_delta: packetsSent(stats_after) - packetsSent(stats_before),
        in_call_status,
        left,
        audio_blocks_seen: audioBlocks,
        events,
      },
      null,
      2,
    ),
  )
  return 0
}

if (import.meta.main) {
  // no-excuse-ok: catch - the QA entry point turns any failure into an exit code
  try {
    process.exit(await main(Bun.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
