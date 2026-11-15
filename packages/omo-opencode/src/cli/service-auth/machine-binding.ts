import { createPrivateKey, sign } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { credentialId } from "./keystore"
import { advertisesMachineIdentity, readMachineDigest } from "./machine-digest"
import { ApiRefusal, type Credentials, parseReply, RequestFailure, SignInError } from "./protocol"
import { requestApi } from "./protocol-request"

type Request = (path: string, init: RequestInit) => Promise<unknown>

/**
 * Binds a device registered before machine identity to this machine (#6503 FINAL contract section 4): the session starts
 * it after a refresh, outside the credential lock, with the refreshed credential, and answers the token read without
 * waiting for it. A call never rejects; a call while a binding is already running joins that one.
 */
export type MachineBinding = {
  (held: Credentials): Promise<void>
  /** Resolves once the binding that is running, if any, has finished: a process waits for it before it exits. */
  settled(): Promise<void>
}

/** How long one binding may take, every request in it included; past it the binding is tried at the next refresh. */
const MACHINE_BINDING_BUDGET_MS = 5_000
/** How long an answer that is not final for this device waits before the service is asked again. */
const MACHINE_BINDING_RETRY_MS = 24 * 60 * 60 * 1000
/**
 * Refusals that settle this device's binding for good: the device was revoked, or the service names the request itself
 * as not allowed (not a desktop/CLI device, a token without a device, already bound to another machine, a signature
 * that did not verify, or forbidden).
 */
const FINAL_REFUSALS: ReadonlySet<string> = new Set(["device_revoked", "invalid_request", "forbidden"])

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
  /** This machine has no validated hardware id: nothing is sent and nothing is kept. */
  | { readonly kind: "no_hardware_id" }
  /** The service does not bind machines yet: asked again after the retry period, silently. */
  | { readonly kind: "unsupported" }
  /** An answer that is not final for this device: asked again after the retry period. */
  | { readonly kind: "later"; readonly reason: string }

const boundSchema = z.object({ deviceId: z.string().min(1) })
const meSchema = z.object({ account: z.object({ id: z.string().min(1) }) })

/** The service never answered, or answered with throttling or its own trouble: asked again at the next refresh. */
function transient(error: unknown): boolean {
  if (error instanceof RequestFailure)
    return error.responseStatus === undefined || error.responseStatus >= 500 || error.responseStatus === 429
  return error instanceof ApiRefusal && (error.status >= 500 || error.status === 429)
}

async function bindHeldDevice(
  options: {
    readonly api: string
    readonly readDigest: () => Promise<string | undefined>
    readonly now: () => number
  },
  held: Credentials,
  request: Request,
): Promise<Outcome> {
  // The hardware id is local: a machine without one never reaches the network.
  const machineDigest = await options.readDigest()
  if (machineDigest === undefined) return { kind: "no_hardware_id" }
  if (!advertisesMachineIdentity(await request("/v1/health", { method: "GET" }))) return { kind: "unsupported" }
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
      return { kind: "later", reason: "the service answered for another device than this sign-in's" }
    return { kind: "bound" }
  } catch (error) {
    if (!(error instanceof ApiRefusal) || transient(error)) throw error
    if (error.code === "machine_exists" && error.existingDevice !== undefined)
      return { kind: "machine_exists", deviceId: error.existingDevice }
    if (FINAL_REFUSALS.has(error.code)) return { kind: "refused", code: error.code }
    // A route that is not there yet, an unknown refusal, a second clock_skew or a machine_exists that names no device
    // says nothing final about this device.
    return { kind: "later", reason: `the service answered ${error.code} (${error.status})` }
  }
}

const markerSchema = z.object({
  device: z.string(),
  outcome: z.string(),
  at: z.string(),
  /** Absent: the answer is final for this device. Present: the service is asked again from this time on. */
  retryAt: z.string().datetime().optional(),
})

/** Where the answer for the stored device is kept, next to the signed-out marker: non-secret, one per API origin. */
export const machineBindingMarkerPath = (home: string, api: string): string =>
  join(home, ".omo", "account-state", `${credentialId(api)}.machine-binding.json`)

/** Whether the kept answer for this device still stands at `now`: a final one always, a deferred one until its time. */
async function answerStands(path: string, device: string, now: number): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => null)
  if (text === null) return false
  try {
    const parsed = markerSchema.safeParse(JSON.parse(text))
    if (!parsed.success || parsed.data.device !== device) return false
    return parsed.data.retryAt === undefined || now < Date.parse(parsed.data.retryAt)
  } catch {
    return false
  }
}

async function recordAnswer(
  path: string,
  device: string,
  outcome: string,
  now: number,
  retryAt?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(
    staging,
    JSON.stringify({
      device,
      outcome,
      at: new Date(now).toISOString(),
      ...(retryAt === undefined ? {} : { retryAt: new Date(retryAt).toISOString() }),
    }),
    { mode: 0o600 },
  )
  await rename(staging, path)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The binding a session starts after a refresh (#6503). It reads this machine's hardware id before anything else, so a
 * machine without one never reaches the network. The service's final answer for a device (bound, another device already
 * holds this machine, or a refusal that names this request as not allowed) is recorded and never asked again for that
 * device. An answer that is not final (a service without `hardware-digest-v1`, a route that is not there yet, an unknown
 * refusal, a second clock_skew, any failure on this machine) is recorded with a time after which the service is asked
 * again, so a refresh does not pay for it each time. A request the service did not answer, throttled or failed on its
 * side is tried at the next refresh. A whole binding is bounded by `budgetMs` (5 s), never changes the stored sign-in
 * or its keys, and never fails: every error ends in one log line.
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
  /** The whole binding's time limit; 5 s by default. */
  readonly budgetMs?: number
}): MachineBinding {
  const markerPath = machineBindingMarkerPath(options.home ?? homedir(), options.api)
  const binder = {
    api: options.api,
    readDigest: options.readDigest ?? (() => readMachineDigest()),
    now: options.now ?? Date.now,
  }
  const budgetMs = options.budgetMs ?? MACHINE_BINDING_BUDGET_MS
  const run = async (held: Credentials): Promise<void> => {
    const startedAt = binder.now()
    if (await answerStands(markerPath, held.device.id, startedAt)) return
    const limit = AbortSignal.timeout(budgetMs)
    const signal = options.signal === undefined ? limit : AbortSignal.any([options.signal, limit])
    const request: Request = (path, init) => requestApi(options.api, path, init, signal, options.fetch)
    let outcome: Outcome
    try {
      outcome = await bindHeldDevice(binder, held, request)
    } catch (error) {
      if (transient(error)) {
        options.log(
          `omo: this computer's device could not be bound to it yet (${messageOf(error)}); it is tried again at the next refresh.`,
        )
        return
      }
      outcome = { kind: "later", reason: messageOf(error) }
    }
    if (outcome.kind === "no_hardware_id") return
    if (outcome.kind === "machine_exists")
      options.log(
        `omo: this computer already has another OmO device on your account (${outcome.deviceId}) besides this sign-in's (${held.device.id}). Remove the one you no longer use on the Devices page of your OmO account.`,
      )
    if (outcome.kind === "refused")
      options.log(`omo: the OmO service refused to bind this computer's device (${outcome.code}).`)
    if (outcome.kind === "later")
      options.log(
        `omo: this computer's device could not be bound to it yet (${outcome.reason}); it is tried again in a day.`,
      )
    const deferred = outcome.kind === "unsupported" || outcome.kind === "later"
    try {
      await recordAnswer(
        markerPath,
        held.device.id,
        outcome.kind,
        startedAt,
        deferred ? startedAt + MACHINE_BINDING_RETRY_MS : undefined,
      )
    } catch (error) {
      // Binding again is idempotent on the service, so an answer that could not be kept only costs one more request.
      options.log(`omo: the machine binding answer could not be saved (${messageOf(error)}).`)
    }
  }
  let running: Promise<void> | undefined
  const binding = (held: Credentials): Promise<void> => {
    running ??= run(held)
      .catch((error: unknown) => options.log(`omo: binding this computer's device stopped (${messageOf(error)}).`))
      .finally(() => {
        running = undefined
      })
    return running
  }
  return Object.assign(binding, { settled: async () => await running })
}
