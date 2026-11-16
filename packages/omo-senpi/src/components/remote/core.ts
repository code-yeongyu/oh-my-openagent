import type { DeviceService, RemoteAttach, Timers } from "@oh-my-opencode/device-service-core/device-service"
import type { AliasRegistry } from "../thread/remote/ports"
import { nextActionFor, remoteFailure } from "./codes"
import type {
  BootstrapResult,
  BootstrapSetup,
  DeviceRow,
  Opts,
  R,
  RemoteFailure,
  RemoteSender,
  SessionsList,
  SessionsListFilter,
} from "./types"

// The leaf every member module and client.ts build on: what a member is made from (ClientCore, its deps), the outcome
// shape and the not-yet answer. It imports neither client.ts nor a member module, so no member closes an import cycle.

export type RemoteClientDeps = {
  readonly version: string
  readonly stateDir?: string
  /** The clock seam: every deadline of the client and of its connection runs on it (real timers by default). */
  readonly timers?: Timers
  /** Runs the device service bootstrap for `service.bootstrap`; the internal bootstrap entry provides it (part 4c-3). */
  readonly bootstrap?: (setup: BootstrapSetup) => Promise<BootstrapResult>
  /**
   * The account's alias registry for `aliases.*`. The caller builds it (it needs the account service access, which the
   * client must not import); absent, the alias members answer `unsupported{feature:"aliases"}`.
   */
  readonly aliasRegistry?: () => Promise<AliasRegistry>
  /**
   * Where the gateway store's worker sidecar is (`gateway-store-worker.mjs` beside the plugin's extension bundle). The
   * compiled binary passes its provisioned runtime's copy; from source the store resolves its own worker.
   */
  readonly gatewayWorkerUrl?: URL
  /**
   * Serves an attach as a local engine endpoint (`AttachHandle.serveEndpoint`): the caller hands in omo-native's
   * `serveRemoteAttach`, so the client never imports a net server into `omo remote`'s local-only graph (#13440). Absent,
   * `serveEndpoint` answers `unsupported{feature:"serve_endpoint"}`.
   */
  readonly serveAttach?: (
    attach: RemoteAttach,
    label: string,
  ) => Promise<{
    readonly socketPath: string
    readonly sessionRef: string
    readonly close: () => Promise<void>
  }>
  /**
   * The approval mode of the session this client acts for (a session or connector sender): an open may keep or narrow
   * it, never widen it. Absent, only the narrowest mode passes.
   */
  readonly permissionPreset?: () => string | undefined
  /** Test seam: opens the proven device-service connection (`connectDeviceService` by default). */
  readonly connect?: (options: {
    readonly version: string
    readonly stateDir: string
    readonly timers: Timers
  }) => Promise<DeviceService>
}

export type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure
export const ok = <T>(value: T): Outcome<T> => ({ kind: "ok", value })

/** What every member module is built from: the client's sender, clock, deps, connection and member runner. */
export type ClientCore = {
  readonly sender: RemoteSender
  readonly timers: Timers
  readonly deps: RemoteClientDeps
  /** Runs `body` on the proven connection under the member's deadline; settles with data, never throws. */
  readonly member: <T>(
    opts: Opts | undefined,
    defaultMs: number,
    mutating: boolean,
    body: (svc: DeviceService) => Promise<Outcome<T>>,
    absent?: () => Outcome<T>,
  ) => R<T>
  readonly sessionsList: (filter?: SessionsListFilter, opts?: Opts) => R<SessionsList>
  readonly devicesList: (opts?: Opts) => R<readonly DeviceRow[]>
}

/** The answer of a member whose part has not landed yet. */
export const notYet = (member: string): RemoteFailure =>
  remoteFailure("unsupported", `${member} is not available in this build.`, nextActionFor("unsupported"), {
    details: { feature: member },
  })
