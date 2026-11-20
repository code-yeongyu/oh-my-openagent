import type { ThreadErrorCode, ThreadToolFailure } from "../components/thread/errors"

// The relay daemon's machine.op_result error codes for device ops, kept 1:1.
const RELAY_OP_ERROR_CODES = [
  "device_offline",
  "undelivered",
  "transport_expired",
  "unconfirmed",
  "timeout",
  "host_error",
  "host_not_answering",
] as const
export type RelayOpErrorCode = (typeof RELAY_OP_ERROR_CODES)[number]

export type TransportPickErrorCode = "no_transport" | "hub_not_bundled" | "bad_choice"

export type BunshinSessionErrorCode = ThreadErrorCode | RelayOpErrorCode | TransportPickErrorCode

// The thread tools' failure shape, widened to the SDK's codes; `uncertain` is set only where the relay sets it.
export type BunshinFailure = Omit<ThreadToolFailure, "code"> & {
  readonly code: BunshinSessionErrorCode
  readonly uncertain?: true
}

/** Every failure the eval SDK raises: `{ code, message, next_action }`, as the thread tools return. */
export class BunshinSessionError extends Error {
  readonly code: BunshinSessionErrorCode
  readonly next_action: string
  readonly uncertain: boolean
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(
    code: BunshinSessionErrorCode,
    message: string,
    nextAction: string,
    options: { details?: Readonly<Record<string, unknown>>; uncertain?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "BunshinSessionError"
    this.code = code
    this.next_action = nextAction
    this.uncertain = options.uncertain === true
    this.details = options.details
  }

  toJSON(): BunshinFailure {
    return {
      code: this.code,
      message: this.message,
      next_action: this.next_action,
      ...(this.uncertain ? { uncertain: true as const } : {}),
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

type Target = { readonly operation: string; readonly device: string }
type Rule = { readonly code: BunshinSessionErrorCode; readonly next: (target: Target, requestId: string) => string }

const resend = (): string => "the op was not delivered and its op id is free; resend it"
const askResult = (_: Target, requestId: string): string =>
  `the device may have run it; call bunshin.resultOf(${JSON.stringify(requestId)}) before resending`
const fixArguments = ({ operation }: Target): string =>
  `fix the arguments of ${operation} (see the message) and call it again; resending the same call fails the same way`
const offline = ({ device }: Target): string =>
  `nothing was sent; resend once ${device} is online (check its state in bunshin.listMachines())`
const denied = ({ operation, device }: Target): string =>
  `${device} refuses ${operation} for this device; use a path inside its allowed scope root, or ask its user to allow it`
const transportLost = ({ operation }: Target): string =>
  `the connection dropped; call ${operation} again, and for a write or exec check its effect first`
const serviceDown = (): string =>
  "start this device's device service and sign in (`omo remote status` shows its state), then retry"
const unsupported = ({ operation, device }: Target): string =>
  `${device} does not support ${operation} in this form; update omo on both devices, or pick another operation from bunshin.listTools()`

const rule = (code: BunshinSessionErrorCode, next: Rule["next"]): Rule => ({ code, next })

// Wire codes from the relay op results, the hub, and the relay transport, by recovery class.
const WIRE_RULES: Readonly<Record<string, Rule>> = {
  device_offline: rule("device_offline", offline),
  undelivered: rule("undelivered", resend),
  transport_expired: rule("transport_expired", askResult),
  unconfirmed: rule("unconfirmed", askResult),
  timeout: rule("timeout", askResult),
  host_error: rule("host_error", askResult),
  host_not_answering: rule(
    "host_not_answering",
    ({ device }) =>
      `${device} never answered machine.describe; check that its device service runs and is current, then retry`,
  ),
  invoke_deadline: rule("timeout", askResult),
  malformed: rule("invalid_arguments", fixArguments),
  malformed_frame: rule("invalid_arguments", fixArguments),
  wrong_kind: rule("invalid_arguments", fixArguments),
  invalid_request: rule("invalid_arguments", fixArguments),
  constraint_violation: rule("invalid_arguments", fixArguments),
  invalid_client_name: rule("invalid_arguments", fixArguments),
  policy_denied: rule("scope_denied", denied),
  capability_missing: rule("scope_denied", denied),
  unauthorized: rule("scope_denied", denied),
  forbidden: rule("scope_denied", denied),
  machine_unavailable: rule("device_offline", offline),
  machine_offline_skipped: rule("device_offline", offline),
  offline: rule("device_offline", offline),
  closed: rule("transport_closed", transportLost),
  machine_send_failed: rule("transport_closed", transportLost),
  request_timeout: rule("transport_closed", askResult),
  budget_exceeded: rule("overloaded", ({ operation }) => `${operation} exceeded its budget; narrow it, then retry`),
  agent_busy_refresh: rule("overloaded", ({ operation }) => `the device is refreshing credentials; retry ${operation}`),
  unsupported: rule("unsupported", unsupported),
  op_unknown: rule("unsupported", unsupported),
  tree_transfer_unsupported: rule("unsupported", unsupported),
  result_expired: rule("not_found", () => "the result is gone; run the operation again if it is safe to repeat"),
}

// The relay transport's own codes where they mean something else than the same word on the hub.
const RELAY_TRANSPORT_RULES: Readonly<Record<string, Rule>> = {
  not_connected: rule("host_unavailable", serviceDown),
  refused: rule("host_unavailable", serviceDown),
  server_proof_invalid: rule("host_unavailable", serviceDown),
  insecure_state_dir: rule("host_unavailable", serviceDown),
}

const NAMED_RULES: Readonly<Record<string, Rule>> = {
  ComposedToolInputError: rule("invalid_arguments", fixArguments),
  ComposedToolResultError: rule("unsupported", unsupported),
  CapabilityUnavailableError: rule("unsupported", unsupported),
  MachineNotFoundError: rule("not_found", () => "use an id or alias from bunshin.listMachines()"),
  AmbiguousMachineLookupError: rule("ambiguous_target", () => "use the exact machine id from bunshin.listMachines()"),
  MachineHubConnectError: rule(
    "host_unavailable",
    () => "check the hub config (or the device service with BUNSHIN_TS_TRANSPORT=relay), then retry",
  ),
  FanoutOptionsError: rule("invalid_arguments", fixArguments),
  FanoutDuplicateTargetError: rule(
    "invalid_arguments",
    () => 'list each device once, or call fanout with { dedup: "first" } to skip the repeats',
  ),
  FanoutTimeoutError: rule(
    "timeout",
    ({ device }) =>
      `the callback on ${device} ran past timeoutMs and may have run part of its work; check its effect, then retry with a larger timeoutMs`,
  ),
}

const field = (error: unknown, key: string): unknown =>
  typeof error === "object" && error !== null ? Reflect.get(error, key) : undefined
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

// `machine.op_result` carries `error.uncertain` on the entry the relay hands back as the error's detail.
const relayUncertain = (error: unknown): boolean => {
  const detail = field(error, "detail")
  return field(detail, "uncertain") === true || field(field(detail, "error"), "uncertain") === true
}

const TRANSPORT_PREFIX = /^(?:hub transport error \[[^\]]*\]: |invalid composed tool input: )/

const ruleFor = (error: unknown, name: string | undefined, wireCode: string | undefined): Rule | undefined => {
  if (name === "ComposedToolResultError" && /increase limitBytes/.test(text(field(error, "reason")) ?? ""))
    return rule(
      "invalid_arguments",
      ({ operation }) => `the file is larger than limitBytes; call ${operation} with a larger limitBytes`,
    )
  if (wireCode !== undefined && name === "RelayTransportError" && RELAY_TRANSPORT_RULES[wireCode] !== undefined)
    return RELAY_TRANSPORT_RULES[wireCode]
  if (wireCode !== undefined && WIRE_RULES[wireCode] !== undefined) return WIRE_RULES[wireCode]
  if (wireCode === "not_connected") return rule("transport_closed", transportLost)
  return name === undefined ? undefined : NAMED_RULES[name]
}

/** `requestId` defaults to the error's own request id; a caller that passes one (`resultOf`, whose argument is that id) overrides it. */
export function deviceOperationError(
  error: unknown,
  operation: string,
  device: string,
  requestId = text(field(error, "requestId")) ?? "",
): BunshinSessionError {
  if (error instanceof BunshinSessionError) return error
  const name = text(field(error, "name"))
  const wireCode = text(field(error, "code"))
  const reason = (error instanceof Error ? error.message : String(error)).replace(TRANSPORT_PREFIX, "")
  const target = { operation, device }
  const matched = ruleFor(error, name, wireCode)
  const code = matched?.code ?? "internal_error"
  const nextAction =
    matched?.next(target, requestId) ?? `${operation} failed on ${device}; read the message, fix the cause, then retry`
  const details = {
    operation,
    device,
    ...(wireCode === undefined ? {} : { wire_code: wireCode }),
    ...(requestId === "" ? {} : { request_id: requestId }),
  }
  return new BunshinSessionError(code, `${operation} on ${device} failed: ${reason}`, nextAction, {
    details,
    uncertain: relayUncertain(error),
    cause: error,
  })
}
