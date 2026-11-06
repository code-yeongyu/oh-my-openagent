import { LOCAL_CHUNK_MAX } from "./limits.ts";
import type { CommandRpc, DelegatedRoute, LocalRequest, RequestType } from "./protocol.ts";
import { endpointKey } from "./validate-delegated.ts";
import { deviceId } from "./validate-shapes.ts";
import { LOCAL_UPLOAD_PARTS_MAX } from "./upload.ts";
import {
  base64Bytes,
  commandId,
  exactly,
  fail,
  type Fields,
  jsonObject,
  localId,
  uint,
} from "./validate-fields.ts";

// session.command and its upload parts. The command is one engine RPC record, checked here only as a JSON object
// (#105); the receiver classifies it, and the engine owns every limit on its fields.
export type RequestValidators<K extends RequestType> = {
  readonly [P in K]: (v: Fields, id: string) => Extract<LocalRequest, { readonly type: P }>;
};

const commandRpcOf = (v: unknown): CommandRpc => jsonObject(v, "rpc");

export const requestFields = (
  v: Fields,
  names: readonly string[],
  optional: readonly string[] = [],
): Fields => exactly(v, ["id", "type", ...names], optional, "request");

const commandIdField = (v: unknown): { readonly command_id?: string } =>
  v === undefined ? {} : { command_id: commandId(v) };
// Decision 0018: `delegated: true` or an endpoint key opts the command into the client's delegated channel.
const ROUTE_FIELDS = ["command_id", "delegated", "endpoint"];
const routeFields = (m: Fields): DelegatedRoute => {
  const delegated = m["delegated"];
  if (delegated !== undefined && delegated !== true) return fail("delegated");
  return {
    ...(delegated === true ? { delegated: true } : {}),
    ...(m["endpoint"] === undefined ? {} : { endpoint: endpointKey(m["endpoint"]) }),
  };
};

export const COMMAND_REQUEST_VALIDATORS: RequestValidators<
  "session.command" | "session.command_part"
> = {
  "session.command": (v, id) => {
    if (Object.hasOwn(v, "device")) {
      // #393: {device, endpoint, rpc} with no attach; `device` without `endpoint` is invalid_request.
      const m = requestFields(v, ["device", "endpoint", "rpc"], ["command_id"]);
      return {
        id,
        type: "session.command",
        device: deviceId(m["device"]),
        endpoint: endpointKey(m["endpoint"]),
        ...commandIdField(m["command_id"]),
        rpc: commandRpcOf(m["rpc"]),
      };
    }
    if (Object.hasOwn(v, "upload_id")) {
      const m = requestFields(v, ["attach", "upload_id"], ROUTE_FIELDS);
      return {
        id,
        type: "session.command",
        attach: localId(m["attach"], "attach"),
        ...commandIdField(m["command_id"]),
        upload_id: localId(m["upload_id"], "upload_id"),
        ...routeFields(m),
      };
    }
    const m = requestFields(v, ["attach", "rpc"], ROUTE_FIELDS);
    return {
      id,
      type: "session.command",
      attach: localId(m["attach"], "attach"),
      ...commandIdField(m["command_id"]),
      rpc: commandRpcOf(m["rpc"]),
      ...routeFields(m),
    };
  },
  "session.command_part": (v, id) => {
    const m = requestFields(v, ["attach", "upload_id", "index", "count", "b"]);
    const count = uint(m["count"], 1, LOCAL_UPLOAD_PARTS_MAX, "count");
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "b");
    return {
      id,
      type: "session.command_part",
      attach: localId(m["attach"], "attach"),
      upload_id: localId(m["upload_id"], "upload_id"),
      index: uint(m["index"], 0, count - 1, "index"),
      count,
      b: typeof m["b"] === "string" ? m["b"] : fail("b"),
    };
  },
};
