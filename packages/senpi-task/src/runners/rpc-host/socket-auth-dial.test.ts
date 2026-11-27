import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHmac } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { authenticateRpcHost, RpcIdentityError } from "./socket-auth"

// One row per dial outcome of authenticateRpcHost against a scripted host and a scratch key root (the handshake contract
// shared with senpi's and the desktop's clients). Records are written as senpi's host writes them.
const FIRST = "11111111-2222-4333-8444-555555555555"
const SECOND = "99999999-2222-4333-8444-555555555555"
const KEY = "ab".repeat(32)
const SECOND_KEY = "ef".repeat(32)
const SERVER_NONCE = "cd".repeat(32)
const DEAD_PID = 2 ** 22 + 1

type Sent = Record<string, unknown>
type HostKind =
  "challenge" | "no-challenge" | "bad-proof" | "malformed" | "refuses-authenticate" | "challenge-other-launch"
/** Where a row's records go, and the socket path the host serves (its directory exists; the socket file need not). */
type Scene = { readonly keys: string; readonly root: string; readonly socket: string }
type Outcome =
  | "authenticated"
  | "unauthenticated"
  | {
      readonly code: RpcIdentityError["code"]
      readonly detail?: string | ((scene: Scene) => string)
      readonly file?: (scene: Scene) => string
    }
type Row = {
  readonly host: HostKind
  readonly records: (scene: Scene) => void
  readonly provenAs?: { readonly launch: string; readonly key: string }
  readonly dialedPath?: (scene: Scene) => string
  readonly outcome: Outcome
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const write = (keys: string, name: string, body: unknown, mode = 0o600) => {
  writeFileSync(join(keys, name), typeof body === "string" ? body : JSON.stringify(body), { mode })
  chmodSync(join(keys, name), mode)
}
const senpiRecord = (launch: string, key: string, endpoint: unknown, pid: number = process.pid) => ({
  version: 1,
  launch_id: launch,
  key,
  pid,
  process_start: null,
  endpoint,
  created_at: "2026-11-27T00:00:00.000Z",
})
const named = (scene: Scene, launch = FIRST, key = KEY) =>
  write(scene.keys, launch, senpiRecord(launch, key, scene.socket))
const withoutEndpoint = (launch: string) => {
  const { endpoint: _endpoint, ...rest } = senpiRecord(launch, KEY, "")
  return rest
}

function scriptedHost(kind: HostKind, launch: string, key: string) {
  const sent: Sent[] = []
  const hmac = (parts: readonly string[]) =>
    createHmac("sha256", Buffer.from(key, "hex")).update(parts.join("\n"), "utf8").digest("hex")
  const request = async (command: Sent) => {
    sent.push(command)
    const clientNonce = (sent[0]?.auth as { client_nonce: string }).client_nonce
    if (command.type === "authenticate")
      return {
        success:
          kind !== "refuses-authenticate" &&
          command.client_proof === hmac(["senpi-rpc-client", launch, SERVER_NONCE, clientNonce]),
      }
    const proof = hmac(["senpi-rpc-server", launch, clientNonce, SERVER_NONCE])
    const challenge = (launchId: string, serverProof = proof) => ({
      success: true,
      data: { auth: { launch_id: launchId, server_nonce: SERVER_NONCE, server_proof: serverProof } },
    })
    if (kind === "no-challenge") return { success: true, data: { protocol: 1 } }
    if (kind === "malformed") return challenge("not-a-uuid")
    if (kind === "bad-proof") return challenge(launch, "00".repeat(32))
    if (kind === "challenge-other-launch") return challenge(SECOND)
    return challenge(launch)
  }
  return { request, sent }
}

const NO_CHALLENGE = (scene: Scene) =>
  `the host did not authenticate, and key record ${join(scene.keys, FIRST)} names this endpoint; if that launch has ended, the next senpi host start sweeps the record, or delete it`
const asToday = (detail: string, launch = FIRST) => ({
  code: "unsafe_key_record" as const,
  detail,
  file: (scene: Scene) => join(scene.keys, launch),
})
const keysMode = {
  code: "unsafe_key_record" as const,
  detail: (s: Scene) => `mode 0755, must be 0700; run chmod 700 ${s.keys}`,
  file: (s: Scene) => s.keys,
}
const malformedRecord = (detail: string, launch = FIRST) => ({
  code: "unsafe_key_record" as const,
  detail: `${detail}; delete this file`,
  file: (scene: Scene) => join(scene.keys, launch),
})

const ROWS: Record<string, Row> = {
  "A challenge, a record names the endpoint, proofs good": {
    host: "challenge",
    records: (s) => named(s),
    outcome: "authenticated",
  },
  "B challenge, no record": {
    host: "challenge",
    records: () => {},
    outcome: { code: "unsafe_key_record", detail: "missing; set SENPI_RPC_KEY_ROOT to the host's agent dir" },
  },
  "C no challenge, a record names the endpoint": {
    host: "no-challenge",
    records: (s) => named(s),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "C3 no challenge, the record naming the endpoint is a finished launch's": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, s.socket, DEAD_PID)),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "C4 no challenge, the record names the endpoint through a symlinked directory": {
    host: "no-challenge",
    records: (s) => {
      symlinkSync(join(s.root, "sock"), join(s.root, "alias"))
      write(s.keys, FIRST, senpiRecord(FIRST, KEY, join(s.root, "alias", "h.sock")))
    },
    outcome: { code: "host_identity_unproven", detail: (s) => NO_CHALLENGE(s) },
  },
  "C5 no challenge, dialed by a relative path": {
    host: "no-challenge",
    records: (s) => named(s),
    dialedPath: (s) => relative(process.cwd(), s.socket),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "C2 no challenge, the only record names another endpoint": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, join(s.root, "sock", "other.sock"))),
    outcome: "unauthenticated",
  },
  "D0 no challenge, no keys directory": {
    host: "no-challenge",
    records: (s) => rmSync(join(s.root, "rpc"), { recursive: true }),
    outcome: "unauthenticated",
  },
  "C6 no challenge, the record names the endpoint with doubled slashes": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, s.socket.replace("/sock/", "//sock//"))),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "C7 no challenge, dialed with doubled slashes": {
    host: "no-challenge",
    records: (s) => named(s),
    dialedPath: (s) => s.socket.replace("/sock/", "//sock//"),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "C8 no challenge, dialed through a symlinked directory": {
    host: "no-challenge",
    records: (s) => {
      named(s)
      symlinkSync(join(s.root, "sock"), join(s.root, "alias"))
    },
    dialedPath: (s) => join(s.root, "alias", "h.sock"),
    outcome: { code: "host_identity_unproven", detail: NO_CHALLENGE },
  },
  "D no challenge, no record at all": { host: "no-challenge", records: () => {}, outcome: "unauthenticated" },
  "D2 no challenge, only a name that is not a launch id": {
    host: "no-challenge",
    records: (s) => write(s.keys, `${FIRST}.tmp`, ""),
    outcome: "unauthenticated",
  },
  "U unresolvable dialed path while records exist": {
    host: "no-challenge",
    records: (s) => named(s),
    dialedPath: () => "/nonexistent-dir-for-dial/h.sock",
    outcome: { code: "host_identity_unproven", detail: "the dialed endpoint cannot be resolved (ENOENT)" },
  },
  "E malformed launch id": { host: "malformed", records: (s) => named(s), outcome: { code: "host_identity_unproven" } },
  "F wrong server proof": { host: "bad-proof", records: (s) => named(s), outcome: { code: "host_identity_unproven" } },
  "G the named record holds another key": {
    host: "challenge",
    records: (s) => named(s, FIRST, SECOND_KEY),
    outcome: { code: "host_identity_unproven" },
  },
  "H authenticate refused": {
    host: "refuses-authenticate",
    records: (s) => named(s),
    outcome: { code: "auth_failed" },
  },
  "I challenge under a launch that has no record (the found case)": {
    host: "challenge-other-launch",
    records: (s) => named(s),
    outcome: asToday("missing; set SENPI_RPC_KEY_ROOT to the host's agent dir", SECOND),
  },
  "I2 proven as a recorded launch whose record names another endpoint (no endpoint comparison on a challenge)": {
    host: "challenge",
    provenAs: { launch: SECOND, key: SECOND_KEY },
    records: (s) => {
      named(s)
      write(s.keys, SECOND, senpiRecord(SECOND, SECOND_KEY, join(s.root, "sock", "other.sock")))
    },
    outcome: "authenticated",
  },
  "S restarted host: two records name the endpoint, proven as the second": {
    host: "challenge",
    provenAs: { launch: SECOND, key: SECOND_KEY },
    records: (s) => {
      named(s)
      named(s, SECOND, SECOND_KEY)
    },
    outcome: "authenticated",
  },
  "Q4 challenge, the launch's record has no endpoint": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, withoutEndpoint(FIRST)),
    outcome: "authenticated",
  },
  "R challenge, an empty file under another launch name beside the launch's good record": {
    host: "challenge",
    provenAs: { launch: SECOND, key: SECOND_KEY },
    records: (s) => {
      write(s.keys, FIRST, "")
      named(s, SECOND, SECOND_KEY)
    },
    outcome: "authenticated",
  },
  "R2 no challenge, an empty file under a launch name": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, ""),
    outcome: {
      code: "unsafe_key_record",
      detail: "empty, a launch may still be writing it; retry, and delete this file if it stays empty",
      file: (s) => join(s.keys, FIRST),
    },
  },
  "R3 no challenge, a damaged record under a launch name": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, `{"version":1,"launch_id":"${FIRST}"`),
    outcome: malformedRecord("unreadable (invalid)"),
  },
  "Q no challenge, a v1 record without an endpoint": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, withoutEndpoint(FIRST)),
    outcome: malformedRecord("names no absolute endpoint, not a valid version 1 key record"),
  },
  "Q2 no challenge, a v1 record whose endpoint is not a string": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, 7)),
    outcome: malformedRecord("names no absolute endpoint, not a valid version 1 key record"),
  },
  "Q3 no challenge, a v1 record whose endpoint is relative": {
    host: "no-challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, "rpc/h.sock")),
    outcome: malformedRecord("names no absolute endpoint, not a valid version 1 key record"),
  },
  "J record mode 0644": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, KEY, s.socket), 0o644),
    outcome: {
      code: "unsafe_key_record",
      detail: (s) => `mode 0644, must be 0600; run chmod 600 ${join(s.keys, FIRST)}`,
      file: (s) => join(s.keys, FIRST),
    },
  },
  "K record truncated": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, `{"version":1,"launch_id":"${FIRST}","key":"ab`),
    outcome: asToday("unreadable (invalid)"),
  },
  "L record with a short key": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(FIRST, "ab".repeat(8), s.socket)),
    outcome: asToday("not a valid version 1 key record for this launch"),
  },
  "M record is a symlink to a valid record": {
    host: "challenge",
    records: (s) => {
      write(s.keys, "real", senpiRecord(FIRST, KEY, s.socket))
      symlinkSync(join(s.keys, "real"), join(s.keys, FIRST))
    },
    outcome: asToday("unreadable (ELOOP)"),
  },
  "N no challenge, keys directory mode 0755": {
    host: "no-challenge",
    records: (s) => {
      named(s)
      chmodSync(s.keys, 0o755)
    },
    outcome: keysMode,
  },
  "N2 challenge, keys directory mode 0755": {
    host: "challenge",
    records: (s) => {
      named(s)
      chmodSync(s.keys, 0o755)
    },
    outcome: keysMode,
  },
  "O record is an empty file": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, ""),
    outcome: asToday("unreadable (invalid)"),
  },
  "P record names another launch inside": {
    host: "challenge",
    records: (s) => write(s.keys, FIRST, senpiRecord(SECOND, KEY, s.socket)),
    outcome: asToday("not a valid version 1 key record for this launch"),
  },
}

describe.skipIf(process.platform === "win32")("authenticateRpcHost dial outcomes", () => {
  test("N3 no challenge, a key root owned by another uid is refused as readKey refuses it", async () => {
    const root = mkdtempSync(join(tmpdir(), "dial-"))
    roots.push(root)
    mkdirSync(join(root, "rpc", "keys"), { recursive: true, mode: 0o700 })
    const uid = process.getuid?.()
    if (uid === undefined) throw new Error("process.getuid is unavailable on this platform")
    const getuid = spyOn(process, "getuid").mockReturnValue(uid + 1)
    try {
      const host = scriptedHost("no-challenge", FIRST, KEY)
      await expect(authenticateRpcHost(host.request as never, join(root, "h.sock"), root)).rejects.toThrow(
        `unsafe_key_record:${root}: owned by uid ${uid}, not the current user`,
      )
    } finally {
      getuid.mockRestore()
    }
  })

  test.each(Object.entries(ROWS))("%s", async (_name, row) => {
    const root = mkdtempSync(join(tmpdir(), "dial-"))
    roots.push(root)
    const keys = join(root, "rpc", "keys")
    mkdirSync(keys, { recursive: true, mode: 0o700 })
    chmodSync(keys, 0o700)
    mkdirSync(join(root, "sock"))
    const scene = { keys, root, socket: join(root, "sock", "h.sock") }
    row.records(scene)
    const host = scriptedHost(row.host, row.provenAs?.launch ?? FIRST, row.provenAs?.key ?? KEY)
    const dialed = row.dialedPath?.(scene) ?? scene.socket
    const outcome = await authenticateRpcHost(host.request as never, dialed, root).then(
      () => undefined,
      (error: unknown) => error,
    )
    const types = host.sent.map((sent) => sent.type)
    if (row.outcome === "authenticated" || row.outcome === "unauthenticated") {
      expect(outcome).toBeUndefined()
      expect(types).toEqual(
        row.outcome === "authenticated" ? ["get_protocol_info", "authenticate"] : ["get_protocol_info"],
      )
      return
    }
    expect(outcome).toBeInstanceOf(RpcIdentityError)
    expect((outcome as RpcIdentityError).code).toBe(row.outcome.code)
    const detail = typeof row.outcome.detail === "function" ? row.outcome.detail(scene) : row.outcome.detail
    if (detail !== undefined) expect((outcome as Error).message).toEndWith(`: ${detail}`)
    if (row.outcome.file !== undefined)
      expect((outcome as Error).message).toBe(`${row.outcome.code}:${row.outcome.file(scene)}: ${detail}`)
    expect(types).toEqual(
      row.outcome.code === "auth_failed" ? ["get_protocol_info", "authenticate"] : ["get_protocol_info"],
    )
  })
})
