// Command-line flags from an input schema: each top-level property is `--kebab-name`, typed by
// its schema. `--json '{...}'` (or `--input file`, `-` for stdin) supplies the whole input, and
// flags given beside it override its fields. A field its schema marks `writeOnly` is a secret: other
// processes can read an argument list, so it is accepted only through `--input`.
import { SurfaceError } from "./surface.ts";
import type { JsonSchema } from "./schema.ts";

export type Property = {
  readonly name: string;
  readonly flag: string;
  readonly schema: JsonSchema;
  readonly required: boolean;
};

const isObject = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const kebab = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();

export const propertiesOf = (schema: JsonSchema): readonly Property[] => {
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = Array.isArray(schema["required"]) ? schema["required"] : [];
  return Object.entries(properties).map(([name, value]) => ({
    name,
    flag: kebab(name),
    schema: isObject(value) ? value : {},
    required: required.includes(name),
  }));
};

const kindOf = (schema: JsonSchema): string => {
  const kind = schema["type"];
  if (typeof kind === "string") return kind;
  if (Array.isArray(kind))
    return kind.find((each) => each !== "null") ?? "json";
  return Array.isArray(schema["enum"]) ? "string" : "json";
};

export const typeLabel = (schema: JsonSchema): string => {
  if (Array.isArray(schema["enum"]))
    return schema["enum"].map(String).join("|");
  const kind = kindOf(schema);
  if (kind === "array")
    return `${typeLabel(isObject(schema["items"]) ? schema["items"] : {})}...`;
  return kind === "object" ? "json" : kind;
};

const parseJson = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new SurfaceError(
      "usage",
      `${what} is not valid JSON (${text.length} characters given)`,
      "check the quoting, or pass the input with --input <file|->",
    );
  }
};

const secretInArgv = (flag: string): SurfaceError =>
  new SurfaceError(
    "usage",
    `--${flag} is a secret and cannot be passed as an argument`,
    "pass the whole input on stdin with --input -, or from a file with --input <file>",
  );

const scalar = (schema: JsonSchema, raw: string, flag: string): unknown => {
  const kind = kindOf(schema);
  if (kind === "string") return raw;
  if (kind === "boolean") {
    if (raw === "true" || raw === "false") return raw === "true";
    throw new SurfaceError(
      "usage",
      `--${flag} takes true or false, not ${raw}`,
    );
  }
  if (kind === "number" || kind === "integer") {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) {
      throw new SurfaceError("usage", `--${flag} takes a number, not ${raw}`);
    }
    return value;
  }
  return parseJson(raw, `--${flag}`);
};

export type Parsed = {
  readonly input: Readonly<Record<string, unknown>>;
  readonly help: boolean;
};

export const parseFlags = async (
  schema: JsonSchema,
  argv: readonly string[],
  readStdin: () => Promise<string>,
): Promise<Parsed> => {
  const properties = propertiesOf(schema);
  const byFlag = new Map(properties.map((each) => [each.flag, each]));
  const secrets = properties.filter(
    (each) => each.schema["writeOnly"] === true,
  );
  let base: Readonly<Record<string, unknown>> = {};
  const given: Record<string, unknown> = {};
  let help = false;
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at] ?? "";
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new SurfaceError(
        "usage",
        `unexpected argument ${token}`,
        "inputs are --flags",
      );
    }
    const [name = "", inline] = token.slice(2).split(/=(.*)/s, 2);
    const next = (): string => {
      if (inline !== undefined) return inline;
      const value = argv[at + 1];
      if (value === undefined)
        throw new SurfaceError("usage", `--${name} needs a value`);
      at += 1;
      return value;
    };
    if (name === "json" || name === "input") {
      const source = next();
      const text =
        name === "json"
          ? source
          : source === "-"
            ? await readStdin()
            : await Bun.file(source).text();
      const value = parseJson(text, `--${name}`);
      if (!isObject(value))
        throw new SurfaceError("usage", `--${name} must be a JSON object`);
      const carried = secrets.find((each) => each.name in value);
      if (name === "json" && carried !== undefined)
        throw secretInArgv(carried.flag);
      base = value;
      continue;
    }
    const negated = name.startsWith("no-")
      ? byFlag.get(name.slice(3))
      : undefined;
    if (
      negated !== undefined &&
      kindOf(negated.schema) === "boolean" &&
      inline === undefined
    ) {
      given[negated.name] = false;
      continue;
    }
    const property = byFlag.get(name);
    if (property === undefined) {
      const known =
        [...byFlag.keys()].map((flag) => `--${flag}`).join(", ") || "none";
      throw new SurfaceError(
        "usage",
        `unknown flag --${name}`,
        `flags: ${known}, --json, --input`,
      );
    }
    if (secrets.includes(property)) throw secretInArgv(property.flag);
    const kind = kindOf(property.schema);
    if (
      kind === "boolean" &&
      inline === undefined &&
      !["true", "false"].includes(argv[at + 1] ?? "")
    ) {
      given[property.name] = true;
      continue;
    }
    if (kind === "array") {
      const items = isObject(property.schema["items"])
        ? property.schema["items"]
        : {};
      const previous = given[property.name];
      given[property.name] = [
        ...(Array.isArray(previous) ? previous : []),
        scalar(items, next(), name),
      ];
      continue;
    }
    given[property.name] = scalar(property.schema, next(), name);
  }
  return { input: { ...base, ...given }, help };
};
