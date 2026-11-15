import { createPrivateKey, sign } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { credentialId } from "./keystore"
import { advertisesMachineIdentity, readMachineDigest } from "./machine-digest"
import { ApiRefusal, type Credentials, parseReply, SignInError } from "./protocol"
import { requestApi } from "./protocol-request"

type Request = (path: string, init: RequestInit) => Promise<unknown>

/**
 * Binds a device registered before machine identity to this machine (#6503 FINAL contract section 4): the session calls
 * it after a refresh, outside the credential lock, with the refreshed credential.
 */
export type MachineBinding = (held: Credentials) => Promise<void>

const MACHINE_BIND_CONTEXT = "omo-machine-bind-v1"

/** The exact bytes a held-device binding signs: these UTF-8 fields joined by "\n", in this order (contract section 4). */
export function machineBindSigningBytes(fields: {
  readonly origin: string
  readonly accountId: string
  readonly deviceId: string
  readonly machineDigest: string
  readonly issuedAt: number
}): Uint8Array {
  return new TextEncoder().encode(
    [
      MACHINE_BIND_CONTEXT,
      fields.origin,
      fields.accountId,
      fields.deviceId,
      fields.machineDigest,
      String(fields.issuedAt),
    ].join("\n"),
  )
}

type Outcome =
  | { readonly kind: "bound" }
  | { readonly kind: "machine_exists"; readonly deviceId: string }
  | { readonly kind: "refused"; readonly code: string }
  | { readonly kind: "skipped" }

const boundSchema = z.object({ deviceId: z.string().min(1) })
const meSchema = z.object({ account: z.object({ id: z.string().min(1) }) })

async function bindHeldDevice(
  options: {
    readonly api: string
    readonly readDigest: () => Promise<string | undefined>
    readonly now: () => number
  },
  held: Credentials,
  request: Request,
): Promise<Outcome> {
  if (!advertisesMachineIdentity(await request("/v1/health", { method: "GET" }))) return { kind: "skipped" }
  const machineDigest = await options.readDigest()
  if (machineDigest === undefined) return { kind: "skipped" }
  const authorization = { authorization: `Bearer ${held.accessToken}` }
  const accountId =
    held.accountId ?? parseReply(meSchema, await request("/v1/me", { headers: authorization })).account.id
  const key = createPrivateKey({ key: Buffer.from(held.signingPrivateKey, "base64"), format: "der", type: "pkcs8" })
  const put = async (issuedAt: number) => {
    const signature = sign(
      null,
      machineBindSigningBytes({ origin: options.api, accountId, deviceId: held.device.id, machineDigest, issuedAt }),
      key,
    ).toString("base64url")
    return request("/v1/devices/current/machine", {
      method: "PUT",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ machineDigest, issuedAt, signature }),
    })
  }
  try {
    let answer: unknown
    try {
      answer = await put(Math.floor(options.now() / 1000))
    } catch (error) {
      // The service names its own time with clock_skew: one more signature with that time, never a loop.
      if (!(error instanceof ApiRefusal) || error.code !== "clock_skew" || error.serverTime === undefined) throw error
      answer = await put(error.serverTime)
    }
    if (parseReply(boundSchema, answer).deviceId !== held.device.id)
      throw new SignInError("The service bound another device than this sign-in's.")
    return { kind: "bound" }
  } catch (error) {
    if (!(error instanceof ApiRefusal)) throw error
    if (error.code === "machine_exists" && error.existingDevice !== undefined)
      return { kind: "machine_exists", deviceId: error.existingDevice }
    // A refusal that names this request (revoked, bound to another machine, not a machine device) is the answer for
    // this device; throttling and service trouble are asked again at the next refresh.
    if (error.status >= 500 || error.status === 429) throw error
    return { kind: "refused", code: error.code }
  }
}

const markerSchema = z.object({ device: z.string(), outcome: z.string(), at: z.string() })

/** Where the answer for the stored device is kept, next to the signed-out marker: non-secret, one per API origin. */
export const machineBindingMarkerPath = (home: string, api: string): string =>
  join(home, ".omo", "account-state", `${credentialId(api)}.machine-binding.json`)

async function answeredFor(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch(() => null)
  if (text === null) return null
  try {
    const parsed = markerSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.device : null
  } catch {
    return null
  }
}

async function recordAnswer(path: string, device: string, outcome: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, JSON.stringify({ device, outcome, at: new Date().toISOString() }), { mode: 0o600 })
  await rename(staging, path)
}

/**
 * The binding a session runs after a refresh (#6503). The service's answer for a device (bound, another device already
 * holds this machine, or a refusal of this request) is final, so it is recorded and never asked again for that device; a
 * service without `hardware-digest-v1`, a machine with no validated hardware id, and a request that did not complete are
 * asked again at the next refresh. A binding never changes the stored sign-in or its keys.
 */
export function machineBindingAfterRefresh(options: {
  readonly api: string
  readonly log: (line: string) => void
  readonly home?: string
  readonly readDigest?: () => Promise<string | undefined>
  readonly now?: () => number
  /** The fetch the caller's own service requests use (memory sync injects one); the global fetch otherwise. */
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
}): MachineBinding {
  const markerPath = machineBindingMarkerPath(options.home ?? homedir(), options.api)
  const binder = {
    api: options.api,
    readDigest: options.readDigest ?? (() => readMachineDigest()),
    now: options.now ?? Date.now,
  }
  const request: Request = (path, init) => requestApi(options.api, path, init, options.signal, options.fetch)
  return async (held) => {
    if ((await answeredFor(markerPath)) === held.device.id) return
    let outcome: Outcome
    try {
      outcome = await bindHeldDevice(binder, held, request)
    } catch (error) {
      if (!(error instanceof SignInError)) throw error
      options.log(
        `omo: this computer's device could not be bound to it yet (${error.message}); it is tried again later.`,
      )
      return
    }
    if (outcome.kind === "skipped") return
    if (outcome.kind === "machine_exists")
      options.log(
        `omo: this computer already has another OmO device on your account (${outcome.deviceId}) besides this sign-in's (${held.device.id}). Remove the one you no longer use on the Devices page of your OmO account.`,
      )
    if (outcome.kind === "refused")
      options.log(`omo: the OmO service refused to bind this computer's device (${outcome.code}).`)
    try {
      await recordAnswer(markerPath, held.device.id, outcome.kind)
    } catch (error) {
      // Binding again is idempotent on the service, so an answer that could not be kept only costs one more request.
      options.log(
        `omo: the machine binding answer could not be saved (${error instanceof Error ? error.message : String(error)}).`,
      )
    }
  }
}
