/**
 * Standard Schema v1 (https://standardschema.dev), declared here as the spec recommends so the
 * contract keeps zero dependencies, plus the small readers the hand-written validators share.
 * Validators ignore unknown keys: a newer minor version may add fields an older client skips.
 */
export type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey>;
};

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
};

/** A contract validator: a Standard Schema (assignable to StandardSchemaV1) that is always sync. */
export type ContractSchema<Output> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output>;
  };
};

export type Path = ReadonlyArray<PropertyKey>;
export type Issues = StandardIssue[];
/** Reads one value at `path`, recording issues instead of throwing. */
export type Reader<T> = (value: unknown, path: Path, issues: Issues) => T;

const formatPath = (path: Path | undefined): string =>
  `$${(path ?? []).map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`)).join("")}`;

/** Thrown by `parse` when untrusted data does not match the contract; names every bad field. */
export class ContractError extends Error {
  readonly issues: ReadonlyArray<StandardIssue>;
  constructor(issues: ReadonlyArray<StandardIssue>) {
    super(issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`).join("; "));
    this.name = "ContractError";
    this.issues = issues;
  }
}

/** Builds a contract validator from a reader that records issues instead of throwing. */
export const defineSchema = <Output>(
  read: (value: unknown, issues: Issues) => Output,
): ContractSchema<Output> => ({
  "~standard": {
    version: 1,
    vendor: "omo-service",
    validate: (value) => {
      const issues: Issues = [];
      const output = read(value, issues);
      return issues.length === 0 ? { value: output } : { issues };
    },
  },
});

/** Validates `value` and returns it typed, or throws a ContractError naming the bad fields. */
export const parse = <Output>(schema: ContractSchema<Output>, value: unknown): Output => {
  const result = schema["~standard"].validate(value);
  if (result.issues !== undefined) throw new ContractError(result.issues);
  return result.value;
};

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readObject = (
  value: unknown,
  path: Path,
  issues: Issues,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  issues.push({ message: "expected an object", path });
  return {};
};

export const readString = (
  value: unknown,
  path: Path,
  issues: Issues,
  pattern?: RegExp,
): string => {
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ message: "expected a non-empty string", path });
    return "";
  }
  if (pattern !== undefined && !pattern.test(value)) {
    issues.push({ message: `expected a string matching ${pattern.source}`, path });
  }
  return value;
};

export const readOptionalString = (
  value: unknown,
  path: Path,
  issues: Issues,
  pattern?: RegExp,
): string | undefined =>
  value === undefined ? undefined : readString(value, path, issues, pattern);

export const readBoolean = (value: unknown, path: Path, issues: Issues): boolean => {
  if (typeof value === "boolean") return value;
  issues.push({ message: "expected a boolean", path });
  return false;
};

/** A flag that is either absent or exactly `true`; anything else is an issue. */
export const readTrue = (value: unknown, path: Path, issues: Issues): boolean => {
  if (value === true) return true;
  issues.push({ message: "expected true", path });
  return false;
};

export const readOneOf = <const Allowed extends readonly [string, ...string[]]>(
  value: unknown,
  allowed: Allowed,
  path: Path,
  issues: Issues,
): Allowed[number] => {
  const match = allowed.find((candidate) => candidate === value);
  if (match !== undefined) return match;
  issues.push({ message: `expected one of ${allowed.join(", ")}`, path });
  return allowed[0];
};

/** A whole number, zero or more; counts, limits and epochs are never fractional or negative. */
export const readInteger = (value: unknown, path: Path, issues: Issues): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  issues.push({ message: "expected a whole number, zero or more", path });
  return 0;
};

/** Reads an array whose every element is read by `item` at its own index path. */
export const readArray = <Item>(
  value: unknown,
  path: Path,
  issues: Issues,
  item: (element: unknown, path: Path, issues: Issues) => Item,
): ReadonlyArray<Item> => {
  if (!Array.isArray(value)) {
    issues.push({ message: "expected an array", path });
    return [];
  }
  return value.map((element, index) => item(element, [...path, index], issues));
};

/** null stays null (an explicit "none"); anything else must satisfy `read`. */
export const readNullable = <Value>(
  value: unknown,
  path: Path,
  issues: Issues,
  read: (value: unknown, path: Path, issues: Issues) => Value,
): Value | null => (value === null ? null : read(value, path, issues));

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";

/** An absolute http(s) URL: a hostname or bracketed IPv6 host, an optional port, then a path. */
export const HTTP_URL = new RegExp(
  `^https?://(?:${LABEL}(?:\\.${LABEL})*|\\[[0-9A-Fa-f:.]+\\])(?::\\d{1,5})?(?:[/?#]\\S*)?$`,
);
/** A DNS hostname (no scheme, port or path); DNS names are case-insensitive. */
export const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
/** An environment name: dev, staging, prod, or any throwaway environment cloned from them. */
export const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** An ISO-8601 UTC timestamp as produced by `Date.prototype.toISOString`. */
const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

const isCalendarTime = (m: RegExpExecArray): boolean => {
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const t = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    t.getUTCFullYear() === year &&
    t.getUTCMonth() === month - 1 &&
    t.getUTCDate() === day &&
    t.getUTCHours() === hour &&
    t.getUTCMinutes() === minute &&
    t.getUTCSeconds() === second
  );
};

/** Reads an ISO-8601 UTC time whose date and clock fields are real (no Feb 30, no 25:00). */
export const readIsoTime = (value: unknown, path: Path, issues: Issues): string => {
  const text = readString(value, path, issues);
  if (text === "") return text;
  const match = ISO_TIME.exec(text);
  if (match === null || !isCalendarTime(match)) {
    issues.push({ message: "expected an ISO-8601 UTC time", path });
  }
  return text;
};
