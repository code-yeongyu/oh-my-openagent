// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol.ts
import type {
  Capability,
  ClientName,
  ErrorCode,
  PathRefusalProblem,
  PolicyState,
  RefusedReason,
  SessionRowState,
  ThisDeviceState,
} from "./vocabulary.ts";

export * from "./vocabulary.ts";
export type * from "./protocol-status.ts";
import type { SignInReason, Status, StatusGet } from "./protocol-status.ts";
export * from "./protocol-events.ts";
export type * from "./protocol-control.ts";
export type * from "./protocol-machine.ts";
export type * from "./protocol-delegated.ts";
export * from "./protocol-presenter.ts";
export * from "./protocol-deliveries.ts";
import type { DeliveriesRequest, DeliveriesResponseData } from "./protocol-deliveries.ts";
import type { AttachFeatures, ControlRequest, ControlResponseData } from "./protocol-control.ts";
import type { MachineRequest, MachineResponseData } from "./protocol-machine.ts";
import type { DelegatedRequest, DelegatedResponseData } from "./protocol-delegated.ts";
import type {
  IncompleteDevice,
  SessionCandidate,
  SessionCommand,
  SessionCommandAnswer,
  SessionCommandPart,
} from "./protocol-command.ts";
export type * from "./protocol-command.ts";

// The local API v1 messages (docs/local-api.md). One JSON object per LF-terminated line: the handshake, then
// requests {id, type, ...} each answered by exactly one response, and pushed events {type: "event", kind, ...}.
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type Empty = { readonly [key: string]: never };
export type EventOf<K extends string, P> = { readonly type: "event"; readonly kind: K } & P;

export type DeviceRef = { readonly id: string; readonly name: string };
export type Policy = {
  readonly state: PolicyState;
  readonly generation: number;
  readonly this_device: ThisDeviceState;
  readonly homes_pending: number;
  readonly unacked: readonly { readonly device: string; readonly label: string }[];
};
export type ClientInfo = {
  readonly name: ClientName;
  readonly version: string;
  readonly data_home?: string;
};
export type Hello = {
  readonly type: "hello";
  readonly v: number;
  readonly client: ClientInfo;
  readonly client_nonce: string;
};
export type Welcome = {
  readonly type: "welcome";
  readonly v: 1;
  readonly service_version: string;
  readonly owner: "service";
  readonly server_proof: string;
  readonly server_nonce: string;
  readonly capabilities: readonly Capability[];
  readonly state: Status;
};
export type Refused = { readonly type: "refused"; readonly reason: RefusedReason };

export type SessionFilter = {
  readonly device?: string;
  readonly project?: string;
  readonly state?: SessionRowState;
};
// One engine RPC inbound record (decision 0011, #105): opaque here, classified by the receiving engine.
export type CommandRpc = JsonObject;
export type EnvironmentReport = {
  readonly environment_id: string;
  readonly revoked: number;
  readonly closed: number;
};

// Every request names its message type as a literal field, so a grep of this file lists every type the docs cover.
export type Authenticate = {
  readonly id: string;
  readonly type: "authenticate";
  readonly client_proof: string;
};
export type StatusSubscribe = { readonly id: string; readonly type: "status.subscribe" };
export type SetEnabled = {
  readonly id: string;
  readonly type: "service.set_enabled";
  readonly enabled: boolean;
};
export type RefresherRegister = {
  readonly id: string;
  readonly type: "refresher.register";
  readonly binary_path: string;
  readonly version: string;
};
export type DeviceAdopt = {
  readonly id: string;
  readonly type: "device.adopt";
  readonly device: DeviceRef;
  // Design D (r6): the signed-in account. A client sends it only to a service whose welcome.service_version is at or
  // above the first relayd that accepts it; older services refuse the unknown field.
  readonly account?: string;
  // 0.1.31 (#1031): asks for sign_in_reason on a sign_in_required refusal; send it only to a 0.1.31+ service.
  readonly sign_in_reason?: true;
  readonly signing_private_key: string;
  readonly sealing_private_key: string;
};
export type DeviceForget = { readonly id: string; readonly type: "device.forget" };
export type DeviceInfo = { readonly id: string; readonly type: "device.info" };
// Decision 0019: besides an engine agent dir, a desktop environment server registers its own socket and key root.
type EnvironmentEndpoint = { readonly kind: "environment"; readonly socket: string };
export type EndpointsRegister = { readonly id: string; readonly type: "endpoints.register" } & (
  | { readonly agent_dir: string }
  | (EnvironmentEndpoint & { readonly key_root: string })
);
export type EndpointsUnregister = { readonly id: string; readonly type: "endpoints.unregister" } & (
  | { readonly agent_dir: string }
  | EnvironmentEndpoint
);
export type DevicesList = {
  readonly id: string;
  readonly type: "devices.list";
  /** #993: true: each row whose peer the roster speaks for (roster v2) carries `managed`; absent, no row does. */
  readonly managed?: true;
};
export type SessionsList = {
  readonly id: string;
  readonly type: "sessions.list";
  readonly filter?: SessionFilter;
  /**
   * 2: this query's rows may carry `kind`, `parent` and `parent_listed` (#316); 3: those and `durable_id` (#935);
   * absent, they never do.
   */
  readonly rows?: 2 | 3;
};
// #1066: opt in, on this connection, to sessions.listing_changed. Send it only to a service at or above the release
// that ships it (docs/local-api.md); an older service refuses the request type.
export type SessionsEventsSubscribe = {
  readonly id: string;
  readonly type: "sessions.events.subscribe";
};
export type SessionAttach = AttachFeatures & {
  readonly id: string;
  readonly type: "session.attach";
  readonly device: string;
  readonly session_id: string;
};
export type SessionDetach = {
  readonly id: string;
  readonly type: "session.detach";
  readonly attach: string;
};
export type SessionRead = {
  readonly id: string;
  readonly type: "session.read";
  readonly attach: string;
  readonly before_entry_id?: string;
  readonly tail?: number;
};
export type EnforcementReport = {
  readonly id: string;
  readonly type: "enforcement.report";
  readonly generation: number;
  readonly data_home: string;
  readonly environments: readonly EnvironmentReport[];
  readonly complete: boolean;
};
export type ShutdownForUpgrade = {
  readonly id: string;
  readonly type: "owner.shutdown_for_upgrade";
  readonly target_version: string;
};
export type LocalRequest =
  | Authenticate
  | StatusGet
  | StatusSubscribe
  | SetEnabled
  | RefresherRegister
  | DeviceAdopt
  | DeviceForget
  | DeviceInfo
  | EndpointsRegister
  | EndpointsUnregister
  | DevicesList
  | SessionsList
  | SessionsEventsSubscribe
  | SessionAttach
  | SessionDetach
  | SessionCommand
  | SessionCommandPart
  | SessionRead
  | EnforcementReport
  | ShutdownForUpgrade
  | ControlRequest
  | DelegatedRequest
  | MachineRequest
  | DeliveriesRequest;
export type RequestType = LocalRequest["type"];

export type DeviceRow = {
  readonly device: string;
  readonly label: string;
  readonly kind: string;
  readonly platform: string;
  readonly last_seen_ms: number | null;
  readonly online: boolean;
  /** #993: only when the request asked (`managed: true`) and the roster is v2: the peer is hosted, not the user's own. */
  readonly managed?: boolean;
};
export type ResponseData = {
  readonly authenticate: Empty;
  readonly "status.get": Status;
  readonly "status.subscribe": Empty;
  readonly "service.set_enabled": { readonly enabled: boolean };
  readonly "refresher.register": Empty;
  readonly "device.adopt": { readonly device: DeviceRef };
  readonly "device.forget": Empty;
  readonly "device.info": { readonly device: DeviceRef | null };
  readonly "endpoints.register": Empty;
  readonly "endpoints.unregister": Empty;
  readonly "devices.list": { readonly devices: readonly DeviceRow[] };
  readonly "sessions.list": { readonly query_id: string };
  readonly "sessions.events.subscribe": Empty;
  readonly "session.attach": { readonly attach: string };
  readonly "session.detach": Empty;
  readonly "session.command": SessionCommandAnswer;
  readonly "session.command_part": { readonly received: number };
  readonly "session.read": { readonly query_id: string };
  readonly "enforcement.report": Empty;
  readonly "owner.shutdown_for_upgrade": Empty;
} & ControlResponseData &
  DelegatedResponseData &
  MachineResponseData &
  DeliveriesResponseData;
export type PathRefusal = { readonly component: string; readonly problem: PathRefusalProblem };
export type ErrorBody = {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly action: string | null;
  readonly limit_chars?: number;
  readonly path_refusal?: PathRefusal;
  /** #1031: on a device.adopt sign_in_required that asked (`sign_in_reason: true`), why sign-in is needed. */
  readonly sign_in_reason?: SignInReason;
  /** #393 part B: on session_ambiguous, every row the alias matched. */
  readonly candidates?: readonly SessionCandidate[];
  /** #393 part B: on an alias's session_not_found, the devices whose listing was not complete. */
  readonly incomplete?: readonly IncompleteDevice[];
};
export type LocalResponse =
  | { readonly id: string; readonly type: "response"; readonly ok: true; readonly data: JsonObject }
  | {
      readonly id: string;
      readonly type: "response";
      readonly ok: false;
      readonly error: ErrorBody;
    };
