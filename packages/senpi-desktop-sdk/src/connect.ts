import type { EngineNotification, RpcPort } from "@oh-my-opencode/senpi-desktop-protocol"
import { LinkedComputer } from "./computer"
import type { ConfirmControl } from "./control"
import { refusal } from "./errors"
import type { Computer } from "./facade"
import { Link } from "./link"
import { attachUds } from "./transport/attach-uds"
import { launchSpawned, type SpawnTransport } from "./transport/spawn"
import { parseAuditEvent, parseEpochChanged, type Parser, parseStopPathStatus } from "./validate"

export type { SpawnLaunch, SpawnSettings, SpawnTransport } from "./transport/spawn"

/**
 * How the SDK reaches an engine session. `inProcess` wraps a port the host already owns (the desktop service, a
 * test fake); `close()` then detaches the SDK and leaves the port to its owner. `spawn` starts an engine child
 * through an injected `launch` outside an omo session; the SDK owns that port and `close()` ends it. `attach`
 * connects to a running `--serve` daemon's unix socket and joins its shared session; `close()` then ends that
 * connection.
 */
export type Transport =
  | { readonly kind: "inProcess"; readonly port: RpcPort }
  | SpawnTransport
  | { readonly kind: "attach"; readonly endpoint: string }

export interface ConnectOptions {
  /** The host's channel for asking the human before `control.acquire` grants; without it acquiring is refused. */
  readonly confirmControl?: ConfirmControl
}

const NOTIFICATION_PARSERS: Readonly<Partial<Record<EngineNotification, Parser<unknown>>>> = {
  audit: parseAuditEvent,
  "epoch.changed": parseEpochChanged,
  "stopPath.changed": parseStopPathStatus,
}

/** A computer over a port the SDK started or opened (`spawn`, `attach`): closing it also ends the port. */
class OwnedComputer extends LinkedComputer {
  readonly #port: RpcPort

  constructor(port: RpcPort, confirmControl: ConfirmControl | undefined) {
    super(new Link(port, NOTIFICATION_PARSERS), confirmControl)
    this.#port = port
  }

  override async close(): Promise<void> {
    await super.close()
    await this.#port.close()
  }
}

/**
 * Opens the SDK over `transport`. Sends nothing on the wire itself: the first facade call is the first request
 * (a `spawn` launcher may handshake with its own child before returning the port).
 */
export async function connect(transport: Transport, options: ConnectOptions = {}): Promise<Computer> {
  if (transport?.kind === "inProcess") {
    return new LinkedComputer(new Link(transport.port, NOTIFICATION_PARSERS), options.confirmControl)
  }
  if (transport?.kind === "spawn") return new OwnedComputer(await launchSpawned(transport), options.confirmControl)
  if (transport?.kind === "attach")
    return new OwnedComputer(await attachUds(transport.endpoint), options.confirmControl)
  const kind = String((transport as { readonly kind?: unknown } | undefined)?.kind)
  throw refusal("InvalidTarget", `transport kind ${kind} is not available in this SDK`, "unsupported_transport")
}
