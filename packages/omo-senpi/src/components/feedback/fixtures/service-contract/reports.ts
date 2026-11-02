import {
  defineSchema,
  type Issues,
  type Path,
  type Reader,
  readArray,
  readInteger,
  readIsoTime,
  readObject,
  readOneOf,
  readOptionalString,
  readString,
} from "./schema.ts";

/**
 * The closed list of report sections (contract 1.19.0). A client sends every section it collected
 * in one submit; `description` and `environment` are always present, since a report without what
 * happened and which build it happened on cannot be acted on.
 */
export const REPORT_SECTION_IDS = [
  "description",
  "identity",
  "environment",
  "session",
  "logs",
  "crash",
  "config",
] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

export const REPORT_KINDS = ["bug", "feedback", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Largest report body, in raw bytes: signed in, and signed out. */
export const REPORT_MAX_BYTES = 25 * 1024 * 1024;
export const ANONYMOUS_REPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * `POST /v1/reports` reads its body exactly once within the cap, so it must declare
 * `content-length` and this header: the lowercase hex SHA-256 of the exact bytes sent.
 */
export const REPORT_SHA256_HEADER = "x-omo-content-sha256";

/**
 * A client's retry key on `POST /v1/reports` (1 to 128 of A-Z a-z 0-9 _ -). Resending the same key
 * from the same caller (the account, or the address when signed out) answers the first report's
 * 201 and stores nothing, however its JSON is laid out; the same key with a different report is
 * 409 `conflict`. A signed-out
 * replay carries no delete token: only the first answer has it.
 */
export const REPORT_IDEMPOTENCY_HEADER = "idempotency-key";
export const REPORT_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,128}$/;

/** A signed-out report's delete token, on `DELETE /v1/reports/:id` in place of a bearer. */
export const REPORT_DELETE_TOKEN_HEADER = "x-omo-report-delete-token";

export type ReportItem = { readonly id: string; readonly text: string };

/** One section as the client's preview showed it, already redacted. */
export type ReportSection = {
  readonly id: ReportSectionId;
  readonly text: string;
  /** A conversation's messages or the log files, one entry each. */
  readonly items?: ReadonlyArray<ReportItem>;
};

export type ReportClient = {
  readonly app: string;
  readonly omo: string;
  readonly senpi: string;
  readonly os: string;
  readonly arch: string;
  readonly locale: string;
  readonly channel: string;
  /** Kept only for a signed-out report; a signed-in one is joined to its device instead. */
  readonly deviceName?: string;
};

/**
 * Body of `POST /v1/reports`. A body where one object repeats a key, or that carries a field not
 * listed here at any depth, is refused (400 `invalid_request`), never stripped. The service stores
 * this value re-serialized, not the bytes sent, and checks every string and key for secrets.
 */
export type CreateReportRequest = {
  readonly kind: ReportKind;
  /** The client redactor's version; one older than the service's minimum is refused (426). */
  readonly redactorVersion: string;
  readonly client: ReportClient;
  /**
   * The telemetry install hash and session hash, sent only with telemetry consent. The service keeps
   * the install hash only with a signed-out report; a signed-in one drops it, so it never sits next
   * to an account (#487).
   */
  readonly installHash?: string;
  readonly sessionHash?: string;
  readonly title: string;
  readonly sections: ReadonlyArray<ReportSection>;
};

/** Body of `POST /v1/reports` (201). `deleteToken` comes once, for a signed-out report only. */
export type CreateReportResponse = {
  readonly id: string;
  readonly expiresAt: string;
  readonly deleteToken?: string;
};

export type ReportSummary = {
  readonly id: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly sizeBytes: number;
};

/** Body of `GET /v1/reports`: the caller's own reports, newest first. */
export type ReportList = { readonly reports: ReadonlyArray<ReportSummary> };

const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const SHORT = /^[\x20-\x7e]{1,64}$/;
const HASH = /^[0-9a-f]{64}$/;

const readText = (value: unknown, path: Path, issues: Issues): string => {
  if (typeof value === "string") return value;
  issues.push({ message: "expected a string", path });
  return "";
};

const readBounded = (max: number) => (value: unknown, path: Path, issues: Issues) => {
  const text = readString(value, path, issues);
  if (text.length > max)
    issues.push({ message: `expected at most ${String(max)} characters`, path });
  return text;
};

const readItem: Reader<ReportItem> = (value, path, issues) => {
  const o = readObject(value, path, issues);
  return {
    id: readBounded(200)(o["id"], [...path, "id"], issues),
    text: readText(o["text"], [...path, "text"], issues),
  };
};

const readSection: Reader<ReportSection> = (value, path, issues) => {
  const o = readObject(value, path, issues);
  const section = {
    id: readOneOf(o["id"], REPORT_SECTION_IDS, [...path, "id"], issues),
    text: readText(o["text"], [...path, "text"], issues),
  };
  return o["items"] === undefined
    ? section
    : { ...section, items: readArray(o["items"], [...path, "items"], issues, readItem) };
};

const readSections = (value: unknown, path: Path, issues: Issues) => {
  const sections = readArray(value, path, issues, readSection);
  const ids = sections.map((section) => section.id);
  if (new Set(ids).size !== ids.length) issues.push({ message: "a section appears twice", path });
  for (const required of ["description", "environment"] as const) {
    if (!ids.includes(required))
      issues.push({ message: `the ${required} section is required`, path });
  }
  return sections;
};

const readClient: Reader<ReportClient> = (value, path, issues) => {
  const o = readObject(value, path, issues);
  const at = (key: string) => readString(o[key], [...path, key], issues, SHORT);
  const deviceName = readOptionalString(o["deviceName"], [...path, "deviceName"], issues);
  return {
    app: at("app"),
    omo: at("omo"),
    senpi: at("senpi"),
    os: at("os"),
    arch: at("arch"),
    locale: at("locale"),
    channel: at("channel"),
    ...(deviceName === undefined
      ? {}
      : { deviceName: readBounded(128)(deviceName, [...path, "deviceName"], issues) }),
  };
};

export const readCreateReportRequest: Reader<CreateReportRequest> = (value, path, issues) => {
  const o = readObject(value, path, issues);
  const at = (key: string): Path => [...path, key];
  const installHash = readOptionalString(o["installHash"], at("installHash"), issues, HASH);
  const sessionHash = readOptionalString(o["sessionHash"], at("sessionHash"), issues, HASH);
  return {
    kind: readOneOf(o["kind"], REPORT_KINDS, at("kind"), issues),
    redactorVersion: readString(o["redactorVersion"], at("redactorVersion"), issues, SEMVER),
    client: readClient(o["client"], at("client"), issues),
    ...(installHash === undefined ? {} : { installHash }),
    ...(sessionHash === undefined ? {} : { sessionHash }),
    title: readBounded(300)(o["title"], at("title"), issues),
    sections: readSections(o["sections"], at("sections"), issues),
  };
};

export const createReportRequestSchema = defineSchema<CreateReportRequest>((value, issues) =>
  readCreateReportRequest(value, [], issues),
);

export const createReportResponseSchema = defineSchema<CreateReportResponse>((value, issues) => {
  const o = readObject(value, [], issues);
  const deleteToken = readOptionalString(o["deleteToken"], ["deleteToken"], issues);
  return {
    id: readString(o["id"], ["id"], issues),
    expiresAt: readIsoTime(o["expiresAt"], ["expiresAt"], issues),
    ...(deleteToken === undefined ? {} : { deleteToken }),
  };
});

const readSummary: Reader<ReportSummary> = (value, path, issues) => {
  const o = readObject(value, path, issues);
  return {
    id: readString(o["id"], [...path, "id"], issues),
    kind: readOneOf(o["kind"], REPORT_KINDS, [...path, "kind"], issues),
    title: readString(o["title"], [...path, "title"], issues),
    createdAt: readIsoTime(o["createdAt"], [...path, "createdAt"], issues),
    expiresAt: readIsoTime(o["expiresAt"], [...path, "expiresAt"], issues),
    sizeBytes: readInteger(o["sizeBytes"], [...path, "sizeBytes"], issues),
  };
};

export const reportListSchema = defineSchema<ReportList>((value, issues) => {
  const o = readObject(value, [], issues);
  return { reports: readArray(o["reports"], ["reports"], issues, readSummary) };
});

/** Orders two strict `MAJOR.MINOR.PATCH` versions; null when either is not one. */
export const compareReportVersions = (a: string, b: string): number | null => {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (left === null || right === null) return null;
  for (let at = 1; at <= 3; at += 1) {
    const diff = Number(left[at]) - Number(right[at]);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};
