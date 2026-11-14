// Vendored from sisyphuslabs/omo-relay-daemon@5bcdcc296c16a4c9af6f0618d5995e1e7ca0354e packages/local-api/src/validate-listing-row.ts
import {
  SESSION_ID_MAX_CHARS,
  SESSION_KIND_MAX_CHARS,
  SESSION_SUMMARY_PATH_MAX_CHARS,
  SESSION_SUMMARY_PROJECT_MAX_CHARS,
  SESSION_SUMMARY_TITLE_MAX_CHARS,
} from "./spec-proto.ts";
import type { ListingRow } from "./protocol.ts";
import { bool, fail, known, oneOf, text } from "./validate-fields.ts";
import { deviceId, millis, sessionId } from "./validate-shapes.ts";
import { LISTING_SOURCES, SESSION_ROW_STATES } from "./vocabulary.ts";

// One sessions.listing_rows row: the nine fields every client reads, plus kind and the parent link at rows 2 (#316)
// and durable_id at rows 3 (#935). Split from validate-shapes.ts for size.
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
export const listingRowOf = (v: unknown): ListingRow => {
  const m = known(v, ROW_FIELDS, ["kind", "parent", "parent_listed", "durable_id"], "listing row");
  const durable = m["durable_id"];
  return {
    ...rowLinks(m),
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
