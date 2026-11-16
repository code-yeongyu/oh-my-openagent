// The local API's wire vocabulary for consumers outside device-service-core that may not reach local-api/ directly (guard
// G1 S1): the remote module's public types (omo-senpi components/remote types.ts, codes.ts). Re-exports from the
// import-free local-api leaf files only, so it adds nothing to their import closure; no code of its own.

export { LocalApiError } from "./local-api/errors"
export type {
  CommandLocated,
  CommandRpc,
  CommandStateEvent,
  ControlAttachState,
  ControlSessionWakeState,
  JsonObject,
  JsonValue,
  SnapshotBody,
  Status,
} from "./local-api/protocol"
export type { ClientErrorCode, ErrorCode } from "./local-api/vocabulary"
