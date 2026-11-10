import type {
  CommandOutcome,
  DeviceRow,
  JsonObject,
  JsonValue,
  ListingRow,
  RoundDeviceState,
  SnapshotBody,
  Status,
} from "../../../src/local-api/protocol.ts";

// What an owner knows, described as plain JSON so the same fixtures can drive the fake owner here and any other
// server implementation that can put itself into this state.
export type WorldEntry =
  | { readonly entry_id: string; readonly entry: JsonValue }
  | { readonly entry_id: string; readonly too_large: true; readonly bytes: number };
export type WorldPage = {
  readonly before_entry_id: string | null;
  readonly entries: readonly WorldEntry[];
  readonly next_before: string | null;
};
export type WorldSession = {
  readonly device: string;
  readonly session_id: string;
  readonly attach_pending?: boolean;
  readonly snapshot: SnapshotBody;
  readonly records: readonly JsonObject[];
  readonly pages: readonly WorldPage[];
  readonly outcome: readonly CommandOutcome[];
  // Decision 0018: a host that takes delegated commands. A delegated command gets these frames, then the engine's reply
  // {type: "response", id, command, success: true, data} as session.command_event, before its outcome states.
  readonly delegated?: { readonly data: JsonObject; readonly frames: readonly JsonObject[] };
};
export type WorldRevision = {
  readonly rows: readonly ListingRow[];
  readonly incomplete: readonly string[];
};
export type World = {
  readonly service_version: string;
  readonly status: Status;
  readonly devices: readonly DeviceRow[];
  readonly listing: {
    readonly revisions: readonly WorldRevision[];
    readonly devices: { readonly [device: string]: RoundDeviceState };
    // The newest sessions.list `rows` version the service knows (default 3); a newer one is refused invalid_request.
    readonly rowsNewest?: 1 | 2 | 3;
  };
  readonly sessions: readonly WorldSession[];
  // Decision 0018: the engine endpoint keys of the devices whose host takes delegated commands; others answer unsupported.
  readonly endpoints?: { readonly [device: string]: readonly string[] };
  // #393 part B: per device, the session key a durable engine id locates; a device absent answers unsupported.
  readonly located?: { readonly [device: string]: { readonly [engineId: string]: string } };
  // #393: what a host engine endpoint answers to an attach-less session.command {device, endpoint, rpc}: the engine's
  // reply data (sent as session.command_event before the states) and the outcome states.
  readonly endpointCommand?: { readonly data: JsonObject; readonly outcome: readonly CommandOutcome[] };
};

export const PEER = "dev-peer-1";
export const OFFLINE_PEER = "dev-peer-2";
export const SESSION_ID = "c2Vzc2lvbi1rZXktMDAwMQ";

const row = (device: string, title: string, source: "live" | "cache"): ListingRow => ({
  device,
  session_id: SESSION_ID,
  title,
  project: "omo",
  path: "/home/user/omo",
  state: "running",
  updated_ms: 1_790_000_000_000,
  source,
  as_of: 1_790_000_100_000,
});

export const defaultWorld = (): World => ({
  service_version: "1.4.0",
  status: {
    state: "connected",
    since_ms: 1_790_000_000_000,
    device: { id: "dev-self", name: "This Mac" },
    origin_configured: true,
    enabled: true,
  },
  devices: [
    {
      device: PEER,
      label: "Studio",
      kind: "desktop",
      platform: "darwin",
      last_seen_ms: 1_790_000_000_000,
      online: true,
    },
    {
      device: OFFLINE_PEER,
      label: "Laptop",
      kind: "cli",
      platform: "linux",
      last_seen_ms: 1_789_000_000_000,
      online: false,
    },
  ],
  listing: {
    revisions: [
      { rows: [row(OFFLINE_PEER, "Cached session", "cache")], incomplete: [PEER] },
      {
        rows: [row(OFFLINE_PEER, "Cached session", "cache"), row(PEER, "Live session", "live")],
        incomplete: [],
      },
    ],
    devices: { [PEER]: "answered", [OFFLINE_PEER]: "undelivered" },
  },
  sessions: [
    {
      device: PEER,
      session_id: SESSION_ID,
      snapshot: {
        attach_id: 1,
        cursor: { marker_id: "m-1", last_entry_id: "e-3" },
        state: { sessionId: "engine-1", isStreaming: false, pendingDialogs: [] },
        entries: [{ id: "e-3", type: "message", text: "hello" }],
        history_truncated: true,
        oldest_entry_id: "e-3",
      },
      records: [{ type: "message_update", text: "hi" }],
      pages: [
        {
          before_entry_id: "e-3",
          entries: [
            { entry_id: "e-1", entry: { id: "e-1", type: "message", text: "first" } },
            { entry_id: "e-2", too_large: true, bytes: 20_000_000 },
          ],
          next_before: null,
        },
      ],
      outcome: [
        { state: "queued", retryable: false },
        { state: "transport_confirmed", retryable: false },
        { state: "engine_applied", retryable: false },
      ],
    },
  ],
});
