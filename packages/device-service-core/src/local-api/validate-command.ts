// Vendored from sisyphuslabs/omo-relay-daemon@08905c110bb10ab2ba725ff8b8c642a64fbd1652 packages/local-api/src/validate-command.ts
import { LOCAL_CHUNK_MAX } from "./limits.ts";
import type {
  CommandRpc,
  CommandTarget,
  SessionCommandPartTarget,
  DelegatedRoute,
  LocalRequest,
  RequestType,
} from "./protocol.ts";
import { endpointKey } from "./validate-delegated.ts";
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
import { ALIAS_MAX_CHARS, parseSessionRef, unsafeAlias } from "./session-ref.ts";
import { deviceId, durableId } from "./validate-shapes.ts";

// session.command and its upload parts. The command is one engine RPC record, checked here only as a JSON object
// (#105); the receiver classifies it, and the engine owns every limit on its fields.
export type RequestValidators<K extends RequestType> = {
  readonly [P in K]: (v: Fields, id: string) => Extract<LocalRequest, { readonly type: P }>;
};

// The one check on an inline or uploaded record; it lives on the validator's path so relayd's default entry never
// imports session-command.ts (DS2b stays inert, RD14).
export const commandRpcOf = (v: unknown): CommandRpc => jsonObject(v, "rpc");

export const requestFields = (
  v: Fields,
  names: readonly string[],
  optional: readonly string[] = [],
): Fields => exactly(v, ["id", "type", ...names], optional, "request");

// omo#13037 A6: the only value is the wake feature, at most once.
const acceptsField = (v: unknown): { readonly accepts?: readonly "session-wake:v1"[] } => {
  if (v === undefined) return {};
  if (!Array.isArray(v) || v.length !== 1 || v[0] !== "session-wake:v1") return fail("accepts");
  return { accepts: ["session-wake:v1"] };
};
const commandIdField = (v: unknown): { readonly command_id?: string } =>
  v === undefined ? {} : { command_id: commandId(v) };
// Decision 0018: `delegated: true` or an endpoint key opts the command into the client's delegated channel.
const ROUTE_FIELDS = ["command_id", "delegated", "endpoint", "locate"];
const routeFields = (m: Fields): DelegatedRoute => {
  const delegated = m["delegated"];
  if (delegated !== undefined && delegated !== true) return fail("delegated");
  const locate = m["locate"];
  if (locate !== undefined && locate !== true) return fail("locate");
  return {
    ...(delegated === true ? { delegated: true } : {}),
    ...(locate === true ? { locate: true } : {}),
    ...(m["endpoint"] === undefined ? {} : { endpoint: endpointKey(m["endpoint"]) }),
  };
};

// #393: exactly one target. `attach` and `device` (with its engine `endpoint`) are part A's; `session` (a session id)
// and `alias` (a title) are part B's and always delegated, so they take neither endpoint nor delegated. A refused
// session or alias never echoes its value (design C2, gate MEDIUM-2).
const TARGETS = ["attach", "device", "session", "alias", "wake"] as const;
type TargetField = (typeof TARGETS)[number];
const targetField = (v: Fields): TargetField => {
  const named = TARGETS.filter((f) => Object.hasOwn(v, f));
  const [only] = named;
  return named.length === 1 && only !== undefined ? only : fail("request names one target");
};
const TARGET_FIELDS: Readonly<Record<TargetField, readonly string[]>> = {
  attach: ["attach"],
  device: ["device", "endpoint"],
  session: ["session"],
  alias: ["alias"],
  wake: ["wake"],
};
const sessionField = (v: unknown): string =>
  typeof v === "string" && parseSessionRef(v) !== undefined ? v : fail("session");
const aliasField = (v: unknown): string =>
  typeof v === "string" &&
  v.length >= 1 &&
  v.length <= ALIAS_MAX_CHARS &&
  v.isWellFormed() &&
  !unsafeAlias(v)
    ? v
    : fail("alias");
type OneField =
  | { readonly attach: string }
  | { readonly session: string }
  | { readonly alias: string }
  | { readonly wake: { readonly device: string; readonly durable_id: string } };
const wakeField = (v: unknown) => {
  const m = exactly(v, ["device", "durable_id"], [], "wake");
  return { device: deviceId(m["device"], "wake.device"), durable_id: durableId(m["durable_id"]) };
};
const oneField = (m: Fields, field: Exclude<TargetField, "device">): OneField => {
  switch (field) {
    case "attach":
      return { attach: localId(m["attach"], "attach") };
    case "session":
      return { session: sessionField(m["session"]) };
    case "alias":
      return { alias: aliasField(m["alias"]) };
    case "wake":
      return { wake: wakeField(m["wake"]) };
  }
};
const targetOf = (m: Fields, field: TargetField): CommandTarget =>
  field === "device"
    ? { device: deviceId(m["device"]), endpoint: endpointKey(m["endpoint"]) }
    : oneField(m, field);
const partTargetOf = (m: Fields, field: TargetField): SessionCommandPartTarget =>
  field === "device" ? { device: deviceId(m["device"]) } : oneField(m, field);

export const COMMAND_REQUEST_VALIDATORS: RequestValidators<
  "session.command" | "session.command_part"
> = {
  "session.command": (v, id) => {
    const field = targetField(v);
    // #701: locate acts only on a {device, endpoint} command; an attach, session or alias command already names its
    // session, so the field is refused there rather than accepted with no effect.
    if (field !== "device" && Object.hasOwn(v, "locate"))
      return fail("locate acts only on a device and endpoint command");
    const target = TARGET_FIELDS[field];
    const body = Object.hasOwn(v, "upload_id") ? "upload_id" : "rpc";
    const delegated = field === "session" || field === "alias" || field === "wake";
    const optional = [
      ...(delegated ? ["command_id"] : ROUTE_FIELDS.filter((f) => !target.includes(f))),
      "accepts",
    ];
    const m = requestFields(v, [...target, body], optional);
    return {
      id,
      type: "session.command",
      ...commandIdField(m["command_id"]),
      ...acceptsField(m["accepts"]),
      ...(body === "upload_id"
        ? { upload_id: localId(m["upload_id"], "upload_id") }
        : { rpc: commandRpcOf(m["rpc"]) }),
      ...routeFields(m),
      ...targetOf(m, field),
    };
  },
  "session.command_part": (v, id) => {
    const target = targetField(v);
    const m = requestFields(v, [target, "upload_id", "index", "count", "b"]);
    const count = uint(m["count"], 1, LOCAL_UPLOAD_PARTS_MAX, "count");
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "b");
    return {
      id,
      type: "session.command_part",
      ...partTargetOf(m, target),
      upload_id: localId(m["upload_id"], "upload_id"),
      index: uint(m["index"], 0, count - 1, "index"),
      count,
      b: typeof m["b"] === "string" ? m["b"] : fail("b"),
    };
  },
};
