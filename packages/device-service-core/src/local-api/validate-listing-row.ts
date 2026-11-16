// Vendored from sisyphuslabs/omo-relay-daemon@edd2ee496fc5b4166f23c4d1cbfb4ed5b9099bb6 packages/local-api/src/validate-listing-row.ts
import {
  SESSION_ID_MAX_CHARS,
  SESSION_KIND_MAX_CHARS,
  SESSION_MODEL_ID_MAX_CHARS,
  SESSION_MODEL_PROVIDER_MAX_CHARS,
  SESSION_SETTLED_DAYS_MAX,
  SESSION_SETTLED_THREAD_TITLE_MAX_CHARS,
  SESSION_SUMMARY_PATH_MAX_CHARS,
  SESSION_SUMMARY_PROJECT_MAX_CHARS,
  SESSION_SUMMARY_TITLE_MAX_CHARS,
} from "./spec-proto.ts";
import type { ListingRow, ListingSettledBy } from "./protocol.ts";
import {
  assertNever,
  bool,
  fail,
  known,
  oneOf,
  text,
  uint,
  type Fields,
} from "./validate-fields.ts";
import { deviceId, millis, sessionId } from "./validate-shapes.ts";
import { LISTING_SETTLED_BY_KINDS, LISTING_SOURCES, SESSION_ROW_STATES } from "./vocabulary.ts";

// One sessions.listing_rows row: the nine fields every client reads, plus kind and the parent link at rows 2 (#316)
// and durable_id at rows 3 (#935), model and archived at rows 4 (#1121), settled and settled_by at rows 5. Split from
// validate-shapes.ts for size.
const ROW_FIELDS = [
  "device",
  "session_id",
  "title",
  "project",
  "path",
  "state",
  "updated_ms",
  "source",
  "as_of",
];
const ROW_KIND = new RegExp(`^[a-z][a-z0-9_-]{0,${SESSION_KIND_MAX_CHARS - 1}}$`);
const rowLinks = (m: {
  readonly [key: string]: unknown;
}): Pick<ListingRow, "kind" | "parent" | "parent_listed"> => {
  const kind = m["kind"];
  if (Object.hasOwn(m, "parent") !== Object.hasOwn(m, "parent_listed")) fail("parent_listed");
  return {
    ...(kind === undefined
      ? {}
      : { kind: typeof kind === "string" && ROW_KIND.test(kind) ? kind : fail("row kind") }),
    ...(m["parent"] === undefined
      ? {}
      : {
          parent: sessionId(m["parent"]),
          parent_listed: bool(m["parent_listed"], "parent_listed"),
        }),
  };
};
const rowModel = (v: unknown): Pick<ListingRow, "model"> => {
  if (v === undefined) return {};
  const m = known(v, ["provider", "id"], [], "model");
  return {
    model: {
      provider: text(m["provider"], SESSION_MODEL_PROVIDER_MAX_CHARS, "model provider"),
      id: text(m["id"], SESSION_MODEL_ID_MAX_CHARS, "model id"),
    },
  };
};
// Rows 5: a reason of a kind this client does not know (a newer engine's) is dropped and the row stays settled; a known
// kind is read with exactly its own fields and bounds.
const settledByOf = (v: unknown): ListingSettledBy | undefined => {
  const named = known(v, ["kind"], [], "settled_by")["kind"];
  if (typeof named !== "string") return fail("settled_by kind");
  const kind = LISTING_SETTLED_BY_KINDS.find((k) => k === named);
  switch (kind) {
    case undefined:
      return undefined;
    case "user":
      return { kind };
    case "agent": {
      const m = known(v, ["kind"], ["threadId", "threadTitle"], "settled_by");
      const id = m["threadId"];
      const title = m["threadTitle"];
      return {
        kind,
        ...(id === undefined
          ? {}
          : { threadId: text(id, SESSION_ID_MAX_CHARS, "settled_by threadId") }),
        ...(title === undefined
          ? {}
          : {
              threadTitle: text(
                title,
                SESSION_SETTLED_THREAD_TITLE_MAX_CHARS,
                "settled_by threadTitle",
                0,
              ),
            }),
      };
    }
    case "pr-merged":
    case "pr-closed": {
      const n = known(v, ["kind"], ["pullRequestNumber"], "settled_by")["pullRequestNumber"];
      return {
        kind,
        ...(n === undefined
          ? {}
          : {
              pullRequestNumber: uint(
                n,
                0,
                Number.MAX_SAFE_INTEGER,
                "settled_by pullRequestNumber",
              ),
            }),
      };
    }
    case "inactivity": {
      const days = known(v, ["kind", "days"], [], "settled_by")["days"];
      return { kind, days: uint(days, 0, SESSION_SETTLED_DAYS_MAX, "settled_by days") };
    }
    default:
      return assertNever(kind);
  }
};
// `settled_by` only beside `settled: true`.
const rowSettled = (m: Fields): Pick<ListingRow, "settled" | "settled_by"> => {
  const reason = m["settled_by"];
  if (m["settled"] === undefined) return reason === undefined ? {} : fail("settled_by");
  const settled = bool(m["settled"], "settled");
  if (reason === undefined) return { settled };
  if (!settled) return fail("settled_by");
  const by = settledByOf(reason);
  return by === undefined ? { settled } : { settled, settled_by: by };
};
export const listingRowOf = (v: unknown): ListingRow => {
  const m = known(
    v,
    ROW_FIELDS,
    ["kind", "parent", "parent_listed", "durable_id", "model", "archived", "settled", "settled_by"],
    "listing row",
  );
  const durable = m["durable_id"];
  const archived = m["archived"];
  return {
    ...rowLinks(m),
    ...rowModel(m["model"]),
    ...rowSettled(m),
    ...(archived === undefined ? {} : { archived: archived === true ? true : fail("archived") }),
    ...(durable === undefined
      ? {}
      : { durable_id: text(durable, SESSION_ID_MAX_CHARS, "durable_id") }),
    device: deviceId(m["device"]),
    session_id: sessionId(m["session_id"]),
    title: text(m["title"], SESSION_SUMMARY_TITLE_MAX_CHARS, "title", 0),
    project: text(m["project"], SESSION_SUMMARY_PROJECT_MAX_CHARS, "project"),
    path: text(m["path"], SESSION_SUMMARY_PATH_MAX_CHARS, "path"),
    state: oneOf(SESSION_ROW_STATES, m["state"], "row state"),
    updated_ms: millis(m["updated_ms"], "updated_ms"),
    source: oneOf(LISTING_SOURCES, m["source"], "row source"),
    as_of: millis(m["as_of"], "as_of"),
  };
};
