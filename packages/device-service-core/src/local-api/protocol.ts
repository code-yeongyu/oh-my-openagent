import type {
  Capability,
  ClientName,
  ErrorCode,
  PolicyState,
  RefusedReason,
  SessionRowState,
  StatusState,
  ThisDeviceState,
} from "./vocabulary.ts";

export * from "./vocabulary.ts";
export * from "./protocol-events.ts";

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
export type Status = {
  readonly state: StatusState;
  readonly since_ms: number;
  readonly detail?: { readonly code: string; readonly action: string | null };
  readonly device: DeviceRef | null;
  readonly origin_configured: boolean;
  readonly enabled: boolean;
  readonly policy?: Policy;
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
export type CommandRequest =
  | { readonly op: "prompt" | "steer"; readonly text: string }
  | { readonly op: "abort" }
  | { readonly op: "permission"; readonly ui_request_id: string; readonly confirmed: boolean }
  | {
      readonly op: "question";
      readonly ui_request_id: string;
      readonly answers: {
        readonly [id: string]: { readonly selected: readonly string[]; readonly text?: string };
      };
      readonly comment?: string;
    };
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
export type StatusGet = { readonly id: string; readonly type: "status.get" };
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
  readonly signing_private_key: string;
  readonly sealing_private_key: string;
};
export type DeviceForget = { readonly id: string; readonly type: "device.forget" };
export type DeviceInfo = { readonly id: string; readonly type: "device.info" };
export type EndpointsRegister = {
  readonly id: string;
  readonly type: "endpoints.register";
  readonly agent_dir: string;
};
export type EndpointsUnregister = {
  readonly id: string;
  readonly type: "endpoints.unregister";
  readonly agent_dir: string;
};
export type DevicesList = { readonly id: string; readonly type: "devices.list" };
export type SessionsList = {
  readonly id: string;
  readonly type: "sessions.list";
  readonly filter?: SessionFilter;
};
export type SessionAttach = {
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
export type SessionCommand =
  | {
      readonly id: string;
      readonly type: "session.command";
      readonly attach: string;
      readonly command_id?: string;
      readonly command: CommandRequest;
    }
  | {
      readonly id: string;
      readonly type: "session.command";
      readonly attach: string;
      readonly command_id?: string;
      readonly upload_id: string;
      readonly op: "prompt" | "steer";
    };
export type SessionCommandPart = {
  readonly id: string;
  readonly type: "session.command_part";
  readonly attach: string;
  readonly upload_id: string;
  readonly index: number;
  readonly count: number;
  readonly b: string;
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
  | SessionAttach
  | SessionDetach
  | SessionCommand
  | SessionCommandPart
  | SessionRead
  | EnforcementReport
  | ShutdownForUpgrade;
export type RequestType = LocalRequest["type"];

export type DeviceRow = {
  readonly device: string;
  readonly label: string;
  readonly kind: string;
  readonly platform: string;
  readonly last_seen_ms: number | null;
  readonly online: boolean;
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
  readonly "session.attach": { readonly attach: string };
  readonly "session.detach": Empty;
  readonly "session.command": { readonly command_id: string };
  readonly "session.command_part": { readonly received: number };
  readonly "session.read": { readonly query_id: string };
  readonly "enforcement.report": Empty;
  readonly "owner.shutdown_for_upgrade": Empty;
};
export type ErrorBody = {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly action: string | null;
  readonly limit_chars?: number;
};
export type LocalResponse =
  | { readonly id: string; readonly type: "response"; readonly ok: true; readonly data: JsonObject }
  | {
      readonly id: string;
      readonly type: "response";
      readonly ok: false;
      readonly error: ErrorBody;
    };
