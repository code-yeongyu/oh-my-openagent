import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "@oh-my-opencode/utils/logger"

export type RpcObject = Readonly<Record<string, unknown>>
export type RpcRequest = (command: RpcObject, timeoutMs?: number) => Promise<RpcObject>
const HEX_32 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const KEY_ROOT_REMEDY = "set SENPI_RPC_KEY_ROOT to the host's agent dir"
// One grace line per key root per process: every endpoint and call under one agent dir shares the cause.
const graceLogged = new Set<string>()

export class RpcIdentityError extends Error {
  constructor(readonly code: "unsafe_key_record" | "host_identity_unproven" | "auth_failed" | "auth_required", location: string, detail?: string) {
    super(detail === undefined ? `${code}:${location}` : `${code}:${location}: ${detail}`)
  }
}

/** An enforcing host's `auth_required` refusal, naming the endpoint and the remedy the missing-record line names. */
export function authRequiredError(endpoint: string): RpcIdentityError {
  return new RpcIdentityError("auth_required", endpoint, `the host requires authentication and no usable key record was found; ${KEY_ROOT_REMEDY}`)
}

function object(value: unknown): value is RpcObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

const octal = (mode: number): string => (mode & 0o7777).toString(8).padStart(4, "0")
const unsafe = (path: string, detail: string) => new RpcIdentityError("unsafe_key_record", path, detail)

/**
 * The key-record rule senpi's and the desktop's clients share: the key root and `rpc/` are real
 * directories owned by this user that nobody else can write (0755 is fine), `rpc/keys` is exactly
 * 0700, and the record is a 0600 regular file owned by this user, opened without following links.
 */
function checkDirectory(path: string, exactMode?: number): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe(path, "not a directory (a symlink is refused); point SENPI_RPC_KEY_ROOT at the real agent dir")
  if (stat.uid !== process.getuid?.()) throw unsafe(path, `owned by uid ${stat.uid}, not the current user`)
  const mode = stat.mode & 0o7777
  if (exactMode !== undefined && mode !== exactMode) throw unsafe(path, `mode ${octal(mode)}, must be ${octal(exactMode)}; run chmod ${exactMode.toString(8)} ${path}`)
  if (exactMode === undefined && (mode & 0o022) !== 0) throw unsafe(path, `mode ${octal(mode)} is group- or world-writable; run chmod go-w ${path}`)
}

function readKey(root: string, launchId: string): Buffer | undefined {
  const path = join(root, "rpc", "keys", launchId)
  let descriptor: number | undefined
  try {
    checkDirectory(root)
    checkDirectory(join(root, "rpc"))
    checkDirectory(join(root, "rpc", "keys"), 0o700)
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw unsafe(path, "not a regular file")
    if (stat.uid !== process.getuid?.()) throw unsafe(path, `owned by uid ${stat.uid}, not the current user`)
    if ((stat.mode & 0o7777) !== 0o600) throw unsafe(path, `mode ${octal(stat.mode)}, must be 0600; run chmod 600 ${path}`)
    const row: unknown = JSON.parse(readFileSync(descriptor, "utf8"))
    if (!object(row) || row.version !== 1 || row.launch_id !== launchId || typeof row.key !== "string" || !HEX_32.test(row.key)) throw unsafe(path, "not a valid version 1 key record for this launch")
    return Buffer.from(row.key, "hex")
  } catch (error) {
    if (error instanceof RpcIdentityError) throw error
    if (missing(error)) return undefined
    throw unsafe(path, `unreadable (${error instanceof Error && "code" in error ? String(error.code) : "invalid"})`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** POSIX public endpoint authentication; raw terminal and Windows secret transports never call it. */
export async function authenticateRpcHost(
  request: RpcRequest,
  endpoint: string,
  keyRoot: string | (() => string),
  command: RpcObject = { type: "get_protocol_info", observe: true },
): Promise<RpcObject> {
  const clientNonce = randomBytes(32).toString("hex")
  // The handshake steps run on the caller's remaining deadline: 2 s is the host's pre-auth read limit, not a client cap.
  const reply = await request({ ...command, auth: { client_nonce: clientNonce } })
  const data = object(reply.data) ? reply.data : undefined
  if (data?.auth === undefined) return reply
  const auth = data.auth
  if (!object(auth) || typeof auth.launch_id !== "string" || !UUID.test(auth.launch_id)
    || typeof auth.server_nonce !== "string" || !HEX_32.test(auth.server_nonce)
    || typeof auth.server_proof !== "string" || !HEX_32.test(auth.server_proof)) {
    throw new RpcIdentityError("host_identity_unproven", endpoint)
  }
  const root = typeof keyRoot === "function" ? keyRoot() : keyRoot
  const key = readKey(root, auth.launch_id)
  if (key === undefined) {
    if (!graceLogged.has(root)) {
      graceLogged.add(root)
      log(`senpi rpc client: no key record for launch ${auth.launch_id} under ${root}; continuing unauthenticated (refused from the next release; ${KEY_ROOT_REMEDY})`)
    }
    return reply
  }
  const proof = (label: string, first: string, second: string) =>
    createHmac("sha256", key).update([label, auth.launch_id, first, second].join("\n"), "utf8").digest()
  if (!timingSafeEqual(proof("senpi-rpc-server", clientNonce, auth.server_nonce), Buffer.from(auth.server_proof, "hex"))) {
    throw new RpcIdentityError("host_identity_unproven", endpoint)
  }
  const answer = await request({ type: "authenticate", client_proof: proof("senpi-rpc-client", auth.server_nonce, clientNonce).toString("hex") })
  if (answer.success !== true) throw new RpcIdentityError("auth_failed", endpoint)
  return reply
}
