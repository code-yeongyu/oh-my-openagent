import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { anchorMatches, isUserEntry } from "./remote-ops"

// Every outbound request from the engine goes to a dead proxy. Without it the engine ignores a fake base URL and calls
// the real provider endpoint with the fake key (#13272 review), so the run would depend on the network and on a model
// turn. With it, no request leaves the host, and the test never waits for a model turn: it stops at the record that
// says the prompt entry is stored.
const DEAD = "http://127.0.0.1:1"
const BREAKER_MS = 30_000

/**
 * The anchor's transcript contract, proven against the engine that ships (#13272 review): a prompt the engine admits
 * persists as a `message` entry with role `user`, the prompt's text and the prompt's `clientMessageId`, before any
 * provider runs. This drives the pinned engine in RPC mode (the mode a remote session runs in) in an isolated home,
 * stops at the engine's own `entry_appended` record for that user entry, and reads the stored entry back, so the
 * fixtures in remote-ops.test.ts can never drift from production's shape.
 */
describe("the engine's persisted prompt entry", () => {
  test("#given a prompt sent over RPC with a clientMessageId #when the engine stores its user entry #then the entry is a user message the anchor matches by text and by id", async () => {
    const root = mkdtempSync(join(tmpdir(), "remote-anchor-e2e-"))
    const home = join(root, "home")
    const agentDir = join(root, "agent")
    mkdirSync(home, { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    const stamp = Date.now().toString(36)
    const text = `anchor-e2e-${stamp}`
    const clientMessageId = `cm-e2e-${stamp}`
    try {
      const engine = join(
        dirname(createRequire(import.meta.url).resolve("@code-yeongyu/senpi/package.json")),
        "dist",
        "bundle",
        "cli.js",
      )
      const proc = Bun.spawn(["bun", engine, "--mode", "rpc"], {
        cwd: root,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: {
          HOME: home,
          PATH: process.env.PATH ?? "",
          PI_CODING_AGENT_DIR: agentDir,
          SENPI_CODING_AGENT_DIR: agentDir,
          OMO_CODING_AGENT_DIR: agentDir,
          ANTHROPIC_API_KEY: "k-e2e-not-a-real-key",
          ANTHROPIC_BASE_URL: DEAD,
          HTTPS_PROXY: DEAD,
          HTTP_PROXY: DEAD,
          https_proxy: DEAD,
          http_proxy: DEAD,
          NO_PROXY: "",
          no_proxy: "",
        },
      })
      // Read the record stream before sending; end at the engine's own record that the user entry is stored.
      const stored = (async (): Promise<boolean> => {
        const decoder = new TextDecoder()
        let buffered = ""
        for await (const chunk of proc.stdout) {
          buffered += decoder.decode(chunk, { stream: true })
          const lines = buffered.split("\n")
          buffered = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.includes('"type":"entry_appended"') || !line.includes(clientMessageId)) continue
            return true
          }
        }
        return false
      })()
      proc.stdin.write(`${JSON.stringify({ id: "1", type: "prompt", message: text, clientMessageId })}\n`)
      await proc.stdin.flush()
      // A circuit breaker, not a wait: the record arrives within seconds (14 s on a loaded host); past the breaker the engine is killed and the
      // test fails on the expectation below.
      const breaker = setTimeout(() => proc.kill(), BREAKER_MS)
      const sawStoredEntry = await stored
      clearTimeout(breaker)
      proc.kill()
      await proc.exited
      expect(sawStoredEntry).toBe(true)
      const files: string[] = []
      const visit = (dir: string): void => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, name.name)
          if (name.isDirectory()) visit(path)
          else if (name.name.endsWith(".jsonl")) files.push(path)
        }
      }
      visit(agentDir)
      const entry = files
        .flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((parsed) => parsed["type"] === "message" && JSON.stringify(parsed).includes(text))
      expect(entry).toBeDefined()
      expect(isUserEntry(entry as never)).toBe(true)
      expect(anchorMatches([entry as never], text)).toEqual([0])
      expect(anchorMatches([entry as never], "a different text entirely", clientMessageId)).toEqual([0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
