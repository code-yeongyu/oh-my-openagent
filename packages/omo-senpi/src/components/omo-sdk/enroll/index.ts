import { deviceServiceHost } from "@oh-my-opencode/device-service-core"
import { z } from "zod"
import type { UserCode } from "../account/sign-in"
import { type EnrolledDevice, type EnrollOutcome, type EnrollStep, type StepReceipt, StepRefusal } from "./outcome"
import { type EnrollRequest, requestProblem } from "./request"
import type { RemoteProgram, SshExit, SshPort } from "./ssh-port"

export type { EnrollCode, EnrollOutcome, EnrollStep, StepReceipt } from "./outcome"
export type { EnrollRequest, SshTarget } from "./request"
export type { RemoteProgram, SshExit, SshPort, SshSession } from "./ssh-port"

export type EnrollClock = {
  readonly now: () => number
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

export type MachineSighting = { readonly id: string; readonly state: "online" | "offline" }

export type EnrollPorts = {
  /** The account service origin this device signs in to; the target signs in to the same one. */
  readonly origin: string
  readonly ssh: (target: EnrollRequest["ssh"]) => SshPort
  /** This account's live device ids, read with the caller's own sign-in. */
  readonly liveDeviceIds: () => Promise<readonly string[]>
  readonly isDeviceRevoked: (id: string) => Promise<boolean>
  /** What the fleet client sees through this device's device service. */
  readonly machines: () => Promise<readonly MachineSighting[]>
  readonly clock: EnrollClock
}

// The read-back's deadline only: the device service's first install on a new machine can take minutes
// (omo-native/remote-bootstrap.ts), so a shorter wait would report a machine that is about to come online as failed.
export const READ_BACK_DEADLINE_MS = 300_000
const READ_BACK_INTERVAL_MS = 5_000

const showSchema = z.union([
  z.object({ signedIn: z.literal(true), device: z.object({ id: z.string().min(1), name: z.string().min(1) }) }),
  z.object({ signedIn: z.literal(false) }),
])
const signInEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("ready") }),
  z.object({
    event: z.literal("code"),
    verificationUri: z.string().url(),
    userCode: z.string().min(1),
    matchingCode: z.string().min(1),
    expiresAt: z.string().min(1),
  }),
  z.object({
    event: z.literal("signed_in"),
    device: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    replacedDeviceId: z.string().min(1).optional(),
    deviceService: z.enum(["on", "kept_off", "not_on", "background"]),
  }),
  z.object({
    event: z.literal("refused"),
    code: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
])
type SignInEvent = z.infer<typeof signInEventSchema>

// The account interface's exits for a credential store (omo-native account-show.ts ACCOUNT_EXIT).
const EXIT_KEYCHAIN_LOCKED = 7
const EXIT_KEYCHAIN_UNAVAILABLE = 8
const EXIT_STORE_UNAVAILABLE = 9

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

type Run = { readonly lines: readonly string[]; readonly exit: SshExit }

const SIGN_IN_REFUSALS: Readonly<Record<string, readonly [StepRefusal["code"], string, string]>> = {
  approval_expired: ["approval_expired", "the code expired before it was approved", "enroll again for a new code"],
  approval_denied: ["approval_denied", "the sign-in was denied", "enroll again if that was a mistake"],
  device_limit: [
    "device_limit",
    "the account has reached its device limit",
    "remove a device the account no longer uses, then enroll again",
  ],
  machine_exists: [
    "machine_exists",
    "the target machine already has a device on this account",
    "enroll again with replace: true to replace it",
  ],
  accounts_unreachable: [
    "accounts_unreachable",
    "the target could not reach OmO accounts",
    "check the target's network",
  ],
  already_signed_in: [
    "signed_in_elsewhere",
    "the target is already signed in",
    "sign the target out, then enroll again",
  ],
  credential_store_locked: [
    "credential_store_locked",
    "the target's credential store is locked",
    "unlock the target's keychain, then enroll again",
  ],
  credential_store_unavailable: [
    "credential_store_unavailable",
    "the target has no usable credential store",
    "make a system keychain available on the target, then enroll again",
  ],
}

export async function enrollDevice(request: EnrollRequest, ports: EnrollPorts): Promise<EnrollOutcome> {
  const steps: StepReceipt[] = []
  const api = ports.origin
  let current: EnrollStep = "request"
  const signal = request.signal
  const pass = (step: EnrollStep, note?: string, outcome: StepReceipt["outcome"] = "ok") =>
    steps.push({ step, outcome, ...(note === undefined ? {} : { note }) })
  const begin = (step: EnrollStep) => {
    current = step
    if (signal?.aborted === true) throw new StepRefusal("aborted", "the enrollment was cancelled", "enroll again")
  }

  const ssh = ports.ssh(request.ssh)
  const run = async (
    program: RemoteProgram,
    stdin?: string,
    onLine?: (line: string) => Promise<void>,
  ): Promise<Run> => {
    const session = ssh.open(program, signal === undefined ? {} : { signal })
    if (stdin !== undefined) session.write(stdin)
    session.end()
    const lines: string[] = []
    for await (const line of session.lines) {
      lines.push(line)
      await onLine?.(line)
    }
    const exit = await session.exit
    if (exit.sshFailure === "host_unverified")
      throw new StepRefusal(
        "ssh_host_unverified",
        "the target's host key is unknown or changed",
        "check the host key out of band, add it to known hosts or pass ssh.hostKey, then enroll again",
      )
    if (exit.sshFailure === "auth_failed")
      throw new StepRefusal(
        "ssh_auth_failed",
        "the target refused the SSH key",
        "load a key the target accepts (agent or identityFile), then enroll again",
      )
    if (exit.sshFailure === "unreachable")
      throw new StepRefusal(
        "ssh_unreachable",
        "the target could not be reached over SSH",
        "check host, port and network",
      )
    return { lines, exit }
  }
  const firstJson = (lines: readonly string[]): unknown => {
    for (const line of lines) {
      const value = parseJson(line)
      if (value !== undefined) return value
    }
    return undefined
  }

  try {
    const problem = requestProblem(request)
    if (problem !== undefined)
      throw new StepRefusal(
        "invalid_request",
        "the enroll request is not valid",
        "fix the request, then enroll again",
        {
          problem,
        },
      )
    pass("request")

    begin("reach")
    const preflight = await run({ kind: "preflight" })
    pass("reach")

    begin("preflight")
    const [os = "", arch = "", omo = "", linger = ""] = preflight.lines
    const platform = os === "Linux" ? "linux" : os === "Darwin" ? "darwin" : undefined
    const cpu =
      arch === "x86_64" || arch === "amd64" ? "x64" : arch === "aarch64" || arch === "arm64" ? "arm64" : undefined
    if (platform === undefined || cpu === undefined || deviceServiceHost(platform, cpu) === undefined)
      throw new StepRefusal(
        "unsupported_platform",
        "the device service does not run on the target's platform",
        "enroll a supported machine",
        {
          os: platform ?? "other",
          arch: cpu ?? "other",
        },
      )
    // A user without linger loses its user services when the SSH session ends (systemd), so the read-back may not see it.
    const sessionBound = platform === "linux" && linger === "Linger=no"
    pass("preflight", `${platform}-${cpu}`)

    begin("install")
    const hasVerb = async () => {
      const check = await run({ kind: "sign_in_check", origin: api })
      const event = signInEventSchema.safeParse(firstJson(check.lines))
      return check.exit.code === 0 && event.success && event.data.event === "ready"
    }
    if (omo === "omo:present" && (await hasVerb())) pass("install", "already_installed", "skipped")
    else {
      const install = await run({ kind: "install" })
      if (install.exit.code !== 0 || !(await hasVerb()))
        throw new StepRefusal(
          "install_failed",
          "omo could not be installed on the target",
          "install omo on the target, then enroll again",
          {
            exit: install.exit.code,
          },
        )
      pass("install")
    }

    begin("account_state")
    const show = await run({ kind: "account_show", origin: api })
    if (show.exit.code === EXIT_KEYCHAIN_LOCKED)
      throw new StepRefusal(
        "credential_store_locked",
        "the target's credential store is locked",
        platform === "darwin"
          ? "unlock the target's login keychain, or turn on OmO's own keychain there (omo account store), then enroll again"
          : "unlock the target's Secret Service keyring, then enroll again",
      )
    if (show.exit.code === EXIT_KEYCHAIN_UNAVAILABLE || show.exit.code === EXIT_STORE_UNAVAILABLE)
      throw new StepRefusal(
        "credential_store_unavailable",
        "the target has no usable credential store",
        platform === "darwin"
          ? "make a keychain available to the target user, then enroll again"
          : "repair or stop the target user's Secret Service keyring (with none running, omo keeps the sign-in in a private file), then enroll again",
      )
    const state = showSchema.safeParse(firstJson(show.lines))
    if (!state.success)
      throw new StepRefusal(
        "internal_error",
        "the target's account interface gave no readable answer",
        "update omo on the target",
      )
    let device: EnrolledDevice | undefined
    let already = false
    if (state.data.signedIn) {
      const id = state.data.device.id
      if ((await ports.liveDeviceIds()).includes(id)) {
        device = { id, name: state.data.device.name, platform }
        already = true
        pass("account_state", "already_enrolled")
      } else if (await ports.isDeviceRevoked(id))
        throw new StepRefusal(
          "device_revoked_here",
          "the target holds a sign-in to a device this account revoked",
          "sign the target out, then enroll again",
          { deviceId: id },
        )
      else
        throw new StepRefusal(
          "signed_in_elsewhere",
          "the target is signed in to another account",
          "sign the target out of that account first, then enroll again",
        )
    } else pass("account_state", "signed_out")

    if (device === undefined) {
      begin("sign_in")
      let shown = false
      let outcome: SignInEvent | undefined
      const options = JSON.stringify({
        ...(request.deviceName === undefined ? {} : { deviceName: request.deviceName }),
        ...(request.replace === true ? { replace: true } : {}),
      })
      await run({ kind: "sign_in", origin: api }, options, async (line) => {
        const event = signInEventSchema.safeParse(parseJson(line))
        if (!event.success) return
        if (event.data.event === "code") {
          if (shown) return
          shown = true
          const { event: _event, ...code } = event.data
          await request.onUserCode(code satisfies UserCode)
        } else if (event.data.event === "signed_in" || event.data.event === "refused") outcome = event.data
      })
      if (outcome === undefined)
        throw new StepRefusal("internal_error", "the target's sign-in ended without an answer", "enroll again")
      if (outcome.event === "refused") {
        const mapped = SIGN_IN_REFUSALS[outcome.code]
        const devices = outcome.code === "device_limit" ? outcome.details?.["devices"] : undefined
        if (mapped === undefined) throw new StepRefusal("internal_error", "the target's sign-in failed", "enroll again")
        throw new StepRefusal(mapped[0], mapped[1], mapped[2], devices === undefined ? undefined : { devices })
      }
      if (outcome.event !== "signed_in")
        throw new StepRefusal("internal_error", "unexpected sign-in answer", "enroll again")
      pass("sign_in")
      device = { id: outcome.device.id, name: outcome.device.name, platform }

      begin("device_service")
      if (outcome.deviceService === "kept_off" || outcome.deviceService === "not_on")
        throw new StepRefusal(
          "device_service_off",
          "the target signed in but its device service is not on",
          outcome.deviceService === "kept_off"
            ? "turn remote sessions on for the target, then enroll again"
            : "start the target's device service, then enroll again",
          { deviceId: device.id },
        )
      pass("device_service", outcome.deviceService)
    }

    // Every SSH session above has exited before this point, so a device service that lives only as long as a login
    // session cannot be seen online here.
    begin("read_back")
    const deadline = ports.clock.now() + READ_BACK_DEADLINE_MS
    let seen: { listed: boolean; machine: MachineSighting["state"] | "absent" } = { listed: false, machine: "absent" }
    for (;;) {
      const [ids, machines] = await Promise.all([ports.liveDeviceIds(), ports.machines()])
      const machine = machines.find((row) => row.id === device.id)
      seen = { listed: ids.includes(device.id), machine: machine?.state ?? "absent" }
      if (seen.listed && seen.machine === "online") break
      if (ports.clock.now() >= deadline)
        throw new StepRefusal(
          "not_online_before_deadline",
          "the new device did not come online before the deadline",
          sessionBound
            ? "the target user's services stop when its login session ends: enable lingering for that user, then enroll again"
            : "check the target's device service, then enroll again",
          { deviceId: device.id, listed: seen.listed, machine: seen.machine, sessionBound },
        )
      begin("read_back")
      await ports.clock.sleep(READ_BACK_INTERVAL_MS, signal)
    }
    pass("read_back")
    return { kind: "enrolled", api, device, already, steps }
  } catch (error) {
    const refusal =
      error instanceof StepRefusal
        ? error
        : signal?.aborted === true
          ? new StepRefusal("aborted", "the enrollment was cancelled", "enroll again")
          : new StepRefusal(
              "internal_error",
              "the enrollment failed unexpectedly",
              "enroll again; report it if it repeats",
              {
                name: error instanceof Error ? error.name : typeof error,
              },
            )
    pass(current, refusal.code, "refused")
    return {
      kind: "refused",
      api,
      step: current,
      code: refusal.code,
      message: refusal.reason,
      next_action: refusal.nextAction,
      ...(refusal.details === undefined ? {} : { details: refusal.details }),
      steps,
    }
  }
}
