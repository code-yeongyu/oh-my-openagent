import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export type RpcObject = Readonly<Record<string, unknown>>
export type RpcRequest = (command: RpcObject, timeoutMs?: number) => Promise<RpcObject>
const HEX_32 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const KEY_ROOT_REMEDY = "set SENPI_RPC_KEY_ROOT to the host's agent dir"

export class RpcIdentityError extends Error {
  constructor(
    readonly code: "unsafe_key_record" | "host_identity_unproven" | "auth_failed" | "auth_required",
    location: string,
    detail?: string,
  ) {
    super(detail === undefined ? `${code}:${location}` : `${code}:${location}: ${detail}`)
  }
}

/** An enforcing host's `auth_required` refusal, naming the endpoint and the remedy a missing record names. */
export function authRequiredError(endpoint: string): RpcIdentityError {
  return new RpcIdentityError(
    "auth_required",
    endpoint,
    `the host requires authentication and no usable key record was found; ${KEY_ROOT_REMEDY}`,
  )
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
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw unsafe(path, "not a directory (a symlink is refused); point SENPI_RPC_KEY_ROOT at the real agent dir")
  if (stat.uid !== process.getuid?.()) throw unsafe(path, `owned by uid ${stat.uid}, not the current user`)
  const mode = stat.mode & 0o7777
  if (exactMode !== undefined && mode !== exactMode)
    throw unsafe(path, `mode ${octal(mode)}, must be ${octal(exactMode)}; run chmod ${exactMode.toString(8)} ${path}`)
  if (exactMode === undefined && (mode & 0o022) !== 0)
    throw unsafe(path, `mode ${octal(mode)} is group- or world-writable; run chmod go-w ${path}`)
}

type KeyRecord = { readonly path: string; readonly key: Buffer; readonly endpoint: unknown }

const DELETE_REMEDY = "; delete this file"
const EMPTY_RECORD = "empty, a launch may still be writing it; retry, and delete this file if it stays empty"

const errorCode = (error: unknown) => (error instanceof Error && "code" in error ? String(error.code) : "invalid")

/** The key root's three directories, checked before any record is opened or listed. */
function checkKeyDirectories(root: string): string {
  const keys = join(root, "rpc", "keys")
  checkDirectory(root)
  checkDirectory(join(root, "rpc"))
  checkDirectory(keys, 0o700)
  return keys
}

/**
 * One launch's record, opened without following links; undefined when there is none. Listing, a content fault names
 * its remedy, and an empty file is told apart: senpi creates the file before it writes it.
 */
function readRecord(keys: string, launchId: string, listing = false): KeyRecord | undefined {
  const remedy = listing ? DELETE_REMEDY : ""
  const path = join(keys, launchId)
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw unsafe(path, `not a regular file${remedy}`)
    if (stat.uid !== process.getuid?.()) throw unsafe(path, `owned by uid ${stat.uid}, not the current user`)
    if ((stat.mode & 0o7777) !== 0o600)
      throw unsafe(path, `mode ${octal(stat.mode)}, must be 0600; run chmod 600 ${path}`)
    if (listing && stat.size === 0) throw unsafe(path, EMPTY_RECORD)
    const row: unknown = JSON.parse(readFileSync(descriptor, "utf8"))
    if (
      !object(row) ||
      row.version !== 1 ||
      row.launch_id !== launchId ||
      typeof row.key !== "string" ||
      !HEX_32.test(row.key)
    )
      throw unsafe(path, `not a valid version 1 key record for this launch${remedy}`)
    return { path, key: Buffer.from(row.key, "hex"), endpoint: row.endpoint }
  } catch (error) {
    if (error instanceof RpcIdentityError) throw error
    if (missing(error)) return undefined
    throw unsafe(path, `unreadable (${errorCode(error)})${remedy}`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** The challenged launch's key; a missing record is refused like any other unusable one, so a challenge is never served keyless. */
function readKey(root: string, launchId: string): Buffer {
  const path = join(root, "rpc", "keys", launchId)
  try {
    const record = readRecord(checkKeyDirectories(root), launchId)
    if (record === undefined) throw unsafe(path, `missing; ${KEY_ROOT_REMEDY}`)
    return record.key
  } catch (error) {
    if (error instanceof RpcIdentityError) throw error
    if (missing(error)) throw unsafe(path, `missing; ${KEY_ROOT_REMEDY}`)
    throw unsafe(path, `unreadable (${errorCode(error)})`)
  }
}

/** A path as the file system names it: the socket's own real path, else its real directory and its name. */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return join(realpathSync(dirname(resolve(path))), basename(path))
  }
}

/**
 * For a host that sent no challenge: the path of a record whose launch serves `endpoint`. senpi's host writes the
 * socket it serves into its key record, in this user's 0700 `rpc/keys`, which whoever answers at the endpoint cannot
 * write unless it is this user. A name that is not a launch id is skipped, as senpi's collector does; a record under a
 * launch name that cannot be read, or names no absolute endpoint, refuses the dial instead of counting as naming none.
 */
function recordNaming(root: string, endpoint: string): string | undefined {
  let keys: string
  let names: string[]
  try {
    keys = checkKeyDirectories(root)
    names = readdirSync(keys)
      .filter((name) => UUID.test(name))
      .sort()
  } catch (error) {
    if (error instanceof RpcIdentityError) throw error
    if (missing(error)) return undefined
    throw unsafe(join(root, "rpc", "keys"), `unreadable (${errorCode(error)})`)
  }
  if (names.length === 0) return undefined
  let dialed: string
  try {
    dialed = canonical(endpoint)
  } catch (error) {
    throw new RpcIdentityError(
      "host_identity_unproven",
      endpoint,
      `the dialed endpoint cannot be resolved (${errorCode(error)})`,
    )
  }
  for (const name of names) {
    const record = readRecord(keys, name, true)
    if (record === undefined) continue
    if (typeof record.endpoint !== "string" || !isAbsolute(record.endpoint))
      throw unsafe(record.path, `names no absolute endpoint, not a valid version 1 key record${DELETE_REMEDY}`)
    let served: string
    try {
      served = canonical(record.endpoint)
    } catch {
      served = resolve(record.endpoint)
    }
    if (served === dialed) return record.path
  }
  return undefined
}

const STALE_REMEDY = "if that launch has ended, the next senpi host start sweeps the record, or delete it"

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
  const root = typeof keyRoot === "function" ? keyRoot() : keyRoot
  if (data?.auth === undefined) {
    const named = recordNaming(root, endpoint)
    if (named !== undefined)
      throw new RpcIdentityError(
        "host_identity_unproven",
        endpoint,
        `the host did not authenticate, and key record ${named} names this endpoint; ${STALE_REMEDY}`,
      )
    return reply
  }
  const auth = data.auth
  if (
    !object(auth) ||
    typeof auth.launch_id !== "string" ||
    !UUID.test(auth.launch_id) ||
    typeof auth.server_nonce !== "string" ||
    !HEX_32.test(auth.server_nonce) ||
    typeof auth.server_proof !== "string" ||
    !HEX_32.test(auth.server_proof)
  ) {
    throw new RpcIdentityError("host_identity_unproven", endpoint)
  }
  const key = readKey(root, auth.launch_id)
  const proof = (label: string, first: string, second: string) =>
    createHmac("sha256", key).update([label, auth.launch_id, first, second].join("\n"), "utf8").digest()
  if (
    !timingSafeEqual(proof("senpi-rpc-server", clientNonce, auth.server_nonce), Buffer.from(auth.server_proof, "hex"))
  ) {
    throw new RpcIdentityError("host_identity_unproven", endpoint)
  }
  const answer = await request({
    type: "authenticate",
    client_proof: proof("senpi-rpc-client", auth.server_nonce, clientNonce).toString("hex"),
  })
  if (answer.success !== true) throw new RpcIdentityError("auth_failed", endpoint)
  return reply
}
