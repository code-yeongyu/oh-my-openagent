import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { anchorMatches, isUserEntry } from "./remote-ops"

/**
 * The anchor's transcript contract, proven against the engine that ships (#13272 review): a prompt the engine
 * admits persists as a `message` entry with role `user` and the prompt's text, before any provider runs - so a
 * providerless run still leaves the entry behind. This spawns the pinned engine headless in an isolated home and
 * reads the stored entry back, so the fixtures in remote-ops.test.ts can never drift from production's shape again.
 */
describe("the engine's persisted prompt entry", () => {
  test("#given a headless prompt with no provider #when the engine admits it #then the stored entry is a user message the anchor matches", () => {
    const root = mkdtempSync(join(tmpdir(), "remote-anchor-e2e-"))
    const home = join(root, "home")
    const agentDir = join(root, "agent")
    mkdirSync(home, { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    const text = `anchor-e2e-${Date.now().toString(36)}`
    try {
      const engine = join(
        dirname(createRequire(import.meta.url).resolve("@code-yeongyu/senpi/package.json")),
        "dist",
        "bundle",
        "cli.js",
      )
      const run = spawnSync("bun", [engine, "--print", text], {
        cwd: root,
        env: {
          HOME: home,
          PATH: process.env.PATH ?? "",
          PI_CODING_AGENT_DIR: agentDir,
          SENPI_CODING_AGENT_DIR: agentDir,
          OMO_CODING_AGENT_DIR: agentDir,
          // A syntactically valid key at a dead endpoint: the engine starts and persists the prompt entry, then the
          // turn fails at once on the refused connection - offline, no external traffic.
          ANTHROPIC_API_KEY: "k-e2e-not-a-real-key",
          ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
        },
        timeout: 90_000,
      })
      expect(run.status).not.toBe(0)
      const findEntry = (): Record<string, unknown> | undefined => {
        const sessionDirs: string[] = []
        const visit = (dir: string): void => {
          for (const name of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, name.name)
            if (name.isDirectory()) visit(path)
            else if (name.name.endsWith(".jsonl")) sessionDirs.push(path)
          }
        }
        try {
          visit(agentDir)
        } catch {
          return undefined
        }
        return sessionDirs
          .flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean))
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((parsed) => JSON.stringify(parsed).includes(text))
      }
      // spawnSync returns after the engine process exits, so the entry it admitted is already on disk.
      const entry = findEntry()
      if (entry === undefined)
        console.error("E2E no entry; status", run.status, "stderr:", (run.stderr?.toString() ?? "").slice(0, 400))
      expect(entry).toBeDefined()
      expect(isUserEntry(entry as never)).toBe(true)
      expect(anchorMatches([entry as never], text)).toEqual([0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
  test("#given a prompt sent over RPC with a clientMessageId #when the engine admits it #then the stored user entry carries that id, which the anchor matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "remote-anchor-e2e-id-"))
    const home = join(root, "home")
    const agentDir = join(root, "agent")
    mkdirSync(home, { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    const text = `anchor-e2e-id-${Date.now().toString(36)}`
    const clientMessageId = `cm-e2e-${Date.now().toString(36)}`
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
          ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
        },
      })
      // Read the engine's record stream before sending, and end the run at its own settle: the turn fails at once on
      // the refused endpoint, after the prompt entry was stored.
      const settled = (async (): Promise<boolean> => {
        const decoder = new TextDecoder()
        let buffered = ""
        for await (const chunk of proc.stdout) {
          buffered += decoder.decode(chunk, { stream: true })
          const lines = buffered.split("\n")
          buffered = lines.pop() ?? ""
          for (const line of lines) if (line.includes('"type":"agent_settled"')) return true
        }
        return false
      })()
      proc.stdin.write(`${JSON.stringify({ id: "1", type: "prompt", message: text, clientMessageId })}\n`)
      await proc.stdin.flush()
      const timer = setTimeout(() => proc.kill(), 60_000)
      const sawSettle = await settled
      clearTimeout(timer)
      await proc.stdin.end()
      await proc.exited
      expect(sawSettle).toBe(true)
      const files: string[] = []
      const visit = (dir: string): void => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, name.name)
          if (name.isDirectory()) visit(path)
          else if (name.name.endsWith(".jsonl")) files.push(path)
        }
      }
      visit(agentDir)
      const entries = files
        .flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      const stored = entries.find((parsed) => JSON.stringify(parsed).includes(text))
      expect(stored).toBeDefined()
      expect(anchorMatches([stored as never], "a different text entirely", clientMessageId)).toEqual([0])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
