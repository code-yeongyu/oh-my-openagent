// A small JSON Schema builder. Each builder returns the JSON Schema itself (what MCP tools/list
// and the CLI's --help show) plus a TypeScript type for it, so one definition types the SDK,
// validates CLI and MCP input, and documents every surface. `s.json<T>(schema)` wraps a schema
// written elsewhere (an OpenRPC document, say) under a type you name.

export type JsonSchema = { readonly [keyword: string]: unknown };

declare const carried: unique symbol;

/** A JSON Schema that carries the TypeScript type `T` of the values it accepts. */
export type Schema<T, Optional extends boolean = false> = {
  readonly json: JsonSchema;
  readonly optional: Optional;
  readonly [carried]?: () => T;
};

export type Infer<S> = S extends Schema<infer T, boolean> ? T : never;

export type Shape = { readonly [property: string]: Schema<unknown, boolean> };

type OptionalKeys<P extends Shape> = {
  [K in keyof P]: P[K] extends Schema<unknown, true> ? K : never;
}[keyof P];
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type ObjectOf<P extends Shape> = Simplify<
  { readonly [K in Exclude<keyof P, OptionalKeys<P>>]: Infer<P[K]> } & {
    readonly [K in OptionalKeys<P>]?: Infer<P[K]> | undefined;
  }
>;

export type Doc = {
  readonly description?: string;
  readonly title?: string;
  /** A secret value: emitted as `writeOnly`, and the CLI takes it only through `--input`, never as an argument. */
  readonly secret?: boolean;
};

const described = (doc: Doc = {}): JsonSchema => ({
  ...(doc.title === undefined ? {} : { title: doc.title }),
  ...(doc.description === undefined ? {} : { description: doc.description }),
  ...(doc.secret === true ? { writeOnly: true } : {}),
});

const make = <T>(json: JsonSchema): Schema<T> => ({ json, optional: false });

export const s = {
  string: (doc?: Doc): Schema<string> =>
    make({ type: "string", ...described(doc) }),
  number: (doc?: Doc): Schema<number> =>
    make({ type: "number", ...described(doc) }),
  integer: (doc?: Doc): Schema<number> =>
    make({ type: "integer", ...described(doc) }),
  boolean: (doc?: Doc): Schema<boolean> =>
    make({ type: "boolean", ...described(doc) }),
  unknown: (doc?: Doc): Schema<unknown> => make(described(doc)),
  enum: <const V extends readonly [string, ...string[]]>(
    values: V,
    doc?: Doc,
  ): Schema<V[number]> =>
    make({ type: "string", enum: values, ...described(doc) }),
  array: <T>(items: Schema<T, boolean>, doc?: Doc): Schema<readonly T[]> =>
    make({ type: "array", items: items.json, ...described(doc) }),
  record: <T>(
    values: Schema<T, boolean>,
    doc?: Doc,
  ): Schema<Readonly<Record<string, T>>> =>
    make({
      type: "object",
      additionalProperties: values.json,
      ...described(doc),
    }),
  object: <const P extends Shape>(
    properties: P,
    doc?: Doc,
  ): Schema<ObjectOf<P>> => {
    const entries = Object.entries(properties);
    return make({
      type: "object",
      properties: Object.fromEntries(
        entries.map(([name, value]) => [name, value.json]),
      ),
      required: entries
        .filter(([, value]) => !value.optional)
        .map(([name]) => name),
      additionalProperties: false,
      ...described(doc),
    });
  },
  optional: <T>(inner: Schema<T, boolean>): Schema<T, true> => ({
    json: inner.json,
    optional: true,
  }),
  /** A schema written elsewhere, typed as `T`. Validation covers the keywords `problems` reads. */
  json: <T>(json: JsonSchema): Schema<T> => make(json),
};

const isObject = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

const fits = (kind: unknown, value: unknown): boolean => {
  const actual = typeOf(value);
  return kind === actual || (kind === "number" && actual === "integer");
};

const listOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const resolve = (schema: JsonSchema, root: JsonSchema): JsonSchema => {
  const ref = schema["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return schema;
  let at: unknown = root;
  for (const part of ref.slice(2).split("/"))
    at = isObject(at) ? at[part] : undefined;
  return isObject(at) ? resolve(at, root) : {};
};

const walk = (
  schema: JsonSchema,
  value: unknown,
  path: string,
  root: JsonSchema,
): string[] => {
  const here = resolve(schema, root);
  const kind = here["type"];
  if (kind !== undefined) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    if (!kinds.some((each) => fits(each, value))) {
      return [`${path}: expected ${kinds.join(" or ")}, got ${typeOf(value)}`];
    }
  }
  if (Array.isArray(here["enum"]) && !here["enum"].includes(value)) {
    return [
      `${path}: expected one of ${here["enum"].map((v) => JSON.stringify(v)).join(", ")}`,
    ];
  }
  if ("const" in here && here["const"] !== value) {
    return [`${path}: expected ${JSON.stringify(here["const"])}`];
  }
  const anyOf = [...listOf(here["anyOf"]), ...listOf(here["oneOf"])].filter(
    isObject,
  );
  if (
    anyOf.length > 0 &&
    anyOf.every((each) => walk(each, value, path, root).length > 0)
  ) {
    return [`${path}: matches none of the allowed shapes`];
  }
  const all = listOf(here["allOf"])
    .filter(isObject)
    .flatMap((each) => walk(each, value, path, root));
  if (Array.isArray(value) && isObject(here["items"])) {
    const items = here["items"];
    return [
      ...all,
      ...value.flatMap((item, at) => walk(items, item, `${path}[${at}]`, root)),
    ];
  }
  if (!isObject(value)) return all;
  const properties = isObject(here["properties"]) ? here["properties"] : {};
  const missing = listOf(here["required"])
    .filter(
      (name): name is string =>
        typeof name === "string" && value[name] === undefined,
    )
    .map((name) => `${path}.${name}: required`);
  const extra = here["additionalProperties"];
  const fields = Object.entries(value).flatMap(([name, field]) => {
    const declared = properties[name];
    if (isObject(declared))
      return field === undefined
        ? []
        : walk(declared, field, `${path}.${name}`, root);
    if (extra === false) return [`${path}.${name}: not a known field`];
    return isObject(extra) ? walk(extra, field, `${path}.${name}`, root) : [];
  });
  return [...all, ...missing, ...fields];
};

/** What is wrong with `value` against `schema`; empty when it fits. `$ref`s resolve in `root`. */
export const problems = (
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema = schema,
): string[] => walk(schema, value, "input", root);

export const conforms = <T>(
  schema: Schema<T, boolean>,
  value: unknown,
): value is T => problems(schema.json, value).length === 0;
