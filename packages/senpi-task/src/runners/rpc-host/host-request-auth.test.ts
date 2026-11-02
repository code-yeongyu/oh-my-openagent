import { describe, expect, spyOn, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { configureSharedSubunitLogger } from "@oh-my-opencode/utils/logger"
import { startFakeHost } from "./__fixtures__/fake-host"
import { askHost } from "./host-request"
import { RpcIdentityError } from "./socket-auth"
import { withContractHost, type ContractHost, type ContractHostOptions } from "./testing/contract-host"

const warm = (host: ContractHost) => Reflect.apply(askHost, undefined, [
  host.socket, { type: "warm", id: "warm-contract", cwd: host.root, kind: "worker" }, 2000, { keyRoot: host.root },
]) as ReturnType<typeof askHost>

describe.skipIf(process.platform === "win32")("POSIX raw task host challenge-response", () => {
  test("#given an enforcing authenticated host #when warm is sent #then authenticate succeeds before warm", async () => {
    await withContractHost({ auth: true }, async (host) => {
      expect(await warm(host)).toMatchObject({ success: true, data: { warmed: true } })
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "warm"])
      expect(host.frames[0].frame).toMatchObject({ observe: true, auth: { client_nonce: expect.stringMatching(/^[0-9a-f]{64}$/) } })
      const record = JSON.parse(readFileSync(host.recordPath, "utf8")) as { key: string }
      expect(JSON.stringify(host.frames)).not.toContain(record.key)
    })
  })

  test("#given a today host #when warm runs #then no authenticate is sent", async () => {
    await withContractHost({ legacy: true }, async (host) => {
      expect(await warm(host)).toMatchObject({ success: true })
      expect(host.frames.some(({ frame }) => frame.type === "authenticate")).toBe(false)
    })
  })

  test("#given a wrong server proof #when warm runs #then the connection closes without sending client proof or warm", async () => {
    await withContractHost({ auth: true, badProof: true }, async (host) => {
      await expect(warm(host)).rejects.toThrow("host_identity_unproven")
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info"])
    })
  })

  const unsafe: readonly [string, NonNullable<ContractHostOptions["prepareRecord"]>][] = [
    ["file mode", (path) => chmodSync(path, 0o644)],
    ["directory mode", (_path, root) => chmodSync(`${root}/rpc/keys`, 0o755)],
    ["group-writable key root", (_path, root) => chmodSync(root, 0o775)],
    ["group-writable rpc dir", (_path, root) => chmodSync(`${root}/rpc`, 0o770)],
    ["symlink", (path, root) => { const bytes = readFileSync(path); rmSync(path); writeFileSync(`${root}/record`, bytes, { mode: 0o600 }); symlinkSync(`${root}/record`, path) }],
    ["directory record", (path) => { rmSync(path); mkdirSync(path, { mode: 0o700 }) }],
    ["unreadable mode", (path) => chmodSync(path, 0o000)],
    ["invalid JSON", (path) => writeFileSync(path, "not-json")],
    ["short key", (path) => { const row = JSON.parse(readFileSync(path, "utf8")); row.key = "ab"; writeFileSync(path, JSON.stringify(row)) }],
    ["wrong launch", (path) => { const row = JSON.parse(readFileSync(path, "utf8")); row.launch_id = "00000000-0000-4000-8000-000000000000"; writeFileSync(path, JSON.stringify(row)) }],
    ["wrong version", (path) => { const row = JSON.parse(readFileSync(path, "utf8")); row.version = 2; writeFileSync(path, JSON.stringify(row)) }],
  ]
  const served: readonly [string, NonNullable<ContractHostOptions["prepareRecord"]>][] = [
    ["a 0755 key root", (_path, root) => chmodSync(root, 0o755)],
    ["a 0755 rpc dir", (_path, root) => chmodSync(`${root}/rpc`, 0o755)],
  ]
  test.each(served)("#given %s #when warm runs #then the record is read and authentication succeeds", async (_name, prepareRecord) => {
    await withContractHost({ auth: true, prepareRecord }, async (host) => {
      expect(await warm(host)).toMatchObject({ success: true, data: { warmed: true } })
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "warm"])
    })
  })

  test("#given a group-writable key root #when warm runs #then the typed refusal names the path, its mode and the remedy", async () => {
    await withContractHost({ auth: true, prepareRecord: (_path, root) => chmodSync(root, 0o775) }, async (host) => {
      const refusal = await warm(host).then(() => undefined, (error: unknown) => error)
      expect(refusal).toBeInstanceOf(RpcIdentityError)
      expect((refusal as RpcIdentityError).code).toBe("unsafe_key_record")
      expect((refusal as Error).message).toContain(host.root)
      expect((refusal as Error).message).toContain("0775")
      expect((refusal as Error).message).toContain("chmod")
    })
  })

  test.each(unsafe)("#given unsafe key record: %s #when warm runs #then it refuses without fallback", async (_name, prepareRecord) => {
    await withContractHost({ auth: true, prepareRecord }, async (host) => {
      await expect(warm(host)).rejects.toThrow("unsafe_key_record")
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info"])
    })
  })

  test("#given records belonging to another uid #when warm runs #then ownership is refused", async () => {
    await withContractHost({ auth: true }, async (host) => {
      const uid = process.getuid?.()
      if (uid === undefined) throw new Error("process.getuid is unavailable on this platform")
      const getuid = spyOn(process, "getuid").mockReturnValue(uid + 1)
      try {
        await expect(warm(host)).rejects.toThrow("unsafe_key_record")
        expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info"])
      } finally { getuid.mockRestore() }
    })
  })

  test("#given a missing record #when an enforcing host challenges twice #then grace logs the remedy once to the omo log, never stderr, and the refusal names the endpoint and the remedy", async () => {
    await withContractHost({ auth: true, prepareRecord: (path) => rmSync(path) }, async (host) => {
      const lines: string[] = []
      configureSharedSubunitLogger((message) => { lines.push(message) })
      const warning = spyOn(console, "error").mockImplementation(() => undefined)
      const stderr = spyOn(process.stderr, "write")
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const refusal = await warm(host).then(() => undefined, (error: unknown) => error)
          expect(refusal).toBeInstanceOf(RpcIdentityError)
          expect((refusal as RpcIdentityError).code).toBe("auth_required")
          expect((refusal as Error).message).toContain(host.socket)
          expect((refusal as Error).message).toContain("SENPI_RPC_KEY_ROOT")
        }
        expect(lines.filter((line) => line.includes("SENPI_RPC_KEY_ROOT"))).toHaveLength(1)
        expect(warning).not.toHaveBeenCalled()
        expect(stderr.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("senpi rpc"))).toEqual([])
        expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "warm", "get_protocol_info", "warm"])
      } finally { warning.mockRestore(); stderr.mockRestore(); configureSharedSubunitLogger(undefined) }
    })
  })

  test("#given a host that refuses the client proof and closes #when warm runs #then auth_failed surfaces and warm is never sent", async () => {
    await withContractHost({ auth: true, rejectProof: true }, async (host) => {
      await expect(warm(host)).rejects.toThrow("auth_failed")
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate"])
    })
  })

  test("#given a host whose handshake answer takes longer than 2 s #when askHost has a larger budget #then the handshake uses that budget and warm succeeds", async () => {
    await withContractHost({ auth: true, protocolDelayMs: 2500 }, async (host) => {
      const reply = await Reflect.apply(askHost, undefined, [host.socket, { type: "warm", id: "warm-slow-handshake", cwd: host.root, kind: "worker" }, 6000, { keyRoot: host.root }]) as Awaited<ReturnType<typeof askHost>>
      expect(reply).toMatchObject({ success: true, data: { warmed: true } })
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "warm"])
    })
  }, 10_000)

  test("#given a slow handshake and a host that never answers #when askHost runs #then timeoutMs bounds the whole exchange", async () => {
    await withContractHost({ auth: true, protocolDelayMs: 600, silent: ["warm"] }, async (host) => {
      const started = performance.now()
      const reply = await Reflect.apply(askHost, undefined, [host.socket, { type: "warm", id: "warm-deadline", cwd: host.root, kind: "worker" }, 900, { keyRoot: host.root }]) as Awaited<ReturnType<typeof askHost>>
      const elapsed = performance.now() - started
      expect(reply).toBeUndefined()
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "warm"])
      // The total budget is 900 ms; restarting the timer per step would take 600 ms + 900 ms.
      expect(elapsed).toBeLessThan(1300)
    })
  })

  test("#given a host that writes a non-JSON line before its answers #when warm runs #then the stray line is skipped and the reply arrives", async () => {
    await withContractHost({ auth: true, strayLine: true }, async (host) => {
      expect(await warm(host)).toMatchObject({ success: true, data: { warmed: true } })
      expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info", "authenticate", "warm"])
    })
  })

  const layouts: readonly [string, (home: string) => string][] = [
    ["a standalone engine (~/.senpi/agent)", (home) => join(home, ".senpi", "agent")],
    ["the flat omo layout (~/.omo)", (home) => { mkdirSync(join(home, ".omo"), { mode: 0o700 }); writeFileSync(join(home, ".omo", "settings.json"), "{}"); return join(home, ".omo") }],
  ]
  test.each(layouts)("#given no agent-dir override on %s #when askHost runs without options #then it reads the key record where the thread client resolves the agent dir", async (_name, agentDirOf) => {
    const home = mkdtempSync(join(tmpdir(), "rpc-home-"))
    try {
      const keyRoot = agentDirOf(home)
      mkdirSync(keyRoot, { recursive: true, mode: 0o700 })
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(OMO|SENPI|PI)_CODING_AGENT_DIR$|^SENPI_RPC_KEY_ROOT$/.test(name)))
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./__fixtures__/ask-host-default-root.ts", import.meta.url)), keyRoot], { env: { ...env, HOME: home }, stdout: "pipe", stderr: "pipe" })
      const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout.trim().split("\n").pop() ?? "")).toEqual({ success: true, frames: ["get_protocol_info", "authenticate", "warm"] })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 20_000)
})

test.skipIf(process.platform !== "win32")("#given a Windows task host #when warm is sent #then the raw pipe secret transport remains unchanged", async () => {
  const host = await startFakeHost()
  try {
    const reply = await askHost(host.socketPath, { type: "warm", id: "warm-contract", cwd: process.cwd(), kind: "worker" }, 2000)
    expect(reply).toMatchObject({ success: true, data: { state: "warmed" } })
    expect(host.commands.map((command) => command.type)).toEqual(["warm"])
  } finally {
    await host.stop()
  }
})
