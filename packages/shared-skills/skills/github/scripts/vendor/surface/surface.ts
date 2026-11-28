// One definition of a skill's operations. `op` pairs a schema-typed input with a handler;
// `defineSurface` names the set. From that definition `bind` builds the typed SDK client,
// `runCli` the command line and `mcpHandler` the MCP server, so the three never drift apart.
import {
  conforms,
  problems,
  type Infer,
  type JsonSchema,
  type Schema,
} from "./schema.ts";

export type Annotations = {
  /** Reads only: changes nothing anywhere. */
  readonly readOnly?: boolean;
  /** May delete or overwrite what it touches (meaningful when not readOnly). */
  readonly destructive?: boolean;
  /** Calling it twice with the same input does no more than calling it once. */
  readonly idempotent?: boolean;
  /** Reaches beyond this machine's own state (other machines, the network). */
  readonly openWorld?: boolean;
};

type OpDefinition<I, O> = {
  readonly description: string;
  readonly title?: string;
  readonly input: Schema<I>;
  readonly output?: Schema<O>;
  readonly annotations?: Annotations;
  readonly run: (input: I) => O | Promise<O>;
};

/** An operation: its documentation, its schemas and `invoke`, which validates and then runs. */
export type Op<I, O> = OpDefinition<I, O> & {
  readonly invoke: (input: unknown) => Promise<O>;
};

export type AnyOp = {
  readonly description: string;
  readonly title?: string;
  readonly input: { readonly json: JsonSchema };
  readonly output?: { readonly json: JsonSchema };
  readonly annotations?: Annotations;
  readonly invoke: (input: unknown) => Promise<unknown>;
};

export type Ops = { readonly [name: string]: AnyOp | Ops };

export type SurfaceDefinition<O extends Ops> = {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  /** Guidance an MCP client hands its model: when to use these tools, and how. */
  readonly instructions?: string;
  /** Removes secrets from text. Everything the CLI prints and every MCP tool reply passes through it. */
  readonly redact?: (text: string) => string | Promise<string>;
  readonly ops: O;
};

/** A failure every surface reports the same way: `kind` is machine-readable, `hint` says what to do. */
export class SurfaceError extends Error {
  override readonly name = "SurfaceError";
  readonly kind: string;
  readonly hint: string | undefined;
  constructor(kind: string, message: string, hint?: string) {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
}

export const op = <I, O>(definition: OpDefinition<I, O>): Op<I, O> => ({
  ...definition,
  invoke: async (input: unknown) => {
    const given = input ?? {};
    if (!conforms(definition.input, given)) {
      throw new SurfaceError(
        "usage",
        problems(definition.input.json, given).join("; "),
        "see the operation's input schema (--help on the CLI, inputSchema over MCP)",
      );
    }
    return definition.run(given);
  },
});

export const defineSurface = <const O extends Ops>(
  definition: SurfaceDefinition<O>,
): SurfaceDefinition<O> => definition;

export const isOp = (value: AnyOp | Ops): value is AnyOp =>
  typeof value["invoke"] === "function" &&
  typeof value["description"] === "string";

export type Entry = { readonly path: readonly string[]; readonly op: AnyOp };

/** Every operation with its path, depth-first in definition order. */
export const entries = (
  ops: Ops,
  prefix: readonly string[] = [],
): readonly Entry[] =>
  Object.entries(ops).flatMap(([name, value]) =>
    isOp(value)
      ? [{ path: [...prefix, name], op: value }]
      : entries(value, [...prefix, name]),
  );

type Call<I, O> =
  Readonly<Record<string, never>> extends I
    ? (input?: I) => Promise<O>
    : (input: I) => Promise<O>;

/** The typed SDK a surface defines: `client.group.op(input)`. */
export type Client<O extends Ops> = {
  readonly [K in keyof O]: O[K] extends Op<infer I, infer R>
    ? Call<I, Awaited<R>>
    : O[K] extends Ops
      ? Client<O[K]>
      : never;
};

export function bind<O extends Ops>(ops: O): Client<O>;
export function bind(ops: Ops): unknown {
  return Object.fromEntries(
    Object.entries(ops).map(([name, value]) => [
      name,
      isOp(value) ? (input?: unknown) => value.invoke(input) : bind(value),
    ]),
  );
}

export type Described = {
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
};

// A thrown value can be hostile to reading it (a throwing getter, a Proxy trap, a cycle, a BigInt):
// each read below falls back instead of throwing, so describing a failure never fails.
const field = (error: object, key: string): string | undefined => {
  try {
    const value: unknown = Reflect.get(error, key);
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
};

const json = (value: object): string | undefined => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

/** Any thrown value as `{ kind, message, hint }`, reading `kind` and `hint` where errors carry them; it never throws. */
export const describeError = (error: unknown): Described => {
  if (typeof error !== "object" || error === null) {
    return { kind: "error", message: String(error) };
  }
  const hint = field(error, "hint");
  return {
    kind:
      field(error, "kind") ??
      field(error, "code") ??
      field(error, "name") ??
      "error",
    message:
      field(error, "message") ??
      json(error) ??
      "a thrown value that could not be described",
    ...(hint === undefined ? {} : { hint }),
  };
};

/**
 * A thrown value that is not an Error (or cannot even be asked: `instanceof` throws for a revoked
 * Proxy or a throwing getPrototypeOf trap), as the SurfaceError internal a boundary reports.
 */
export const internalError = (value: unknown): SurfaceError =>
  new SurfaceError("internal", describeError(value).message);

/**
 * The secrets a skill has read, for its surface's `redact`: call `remember` where a secret is read
 * and pass `redact` to `defineSurface`, so no answer the surface prints carries one.
 */
export const secretTally = () => {
  const secrets = new Set<string>();
  return {
    remember: (secret: string): string => {
      if (secret !== "") secrets.add(secret);
      return secret;
    },
    // The longest first, so a secret that contains another is redacted whole.
    redact: (text: string): string =>
      [...secrets]
        .toSorted((a, b) => b.length - a.length)
        .reduce((out, secret) => out.split(secret).join("[redacted]"), text),
  };
};

type Redact = SurfaceDefinition<Ops>["redact"];
type Redactor = NonNullable<Redact>;
type Fields = { readonly [key: string]: unknown };

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Keys are redacted as well as values: a secret is as readable as a property name as it is as a string.
const walkFields = async (redact: Redactor, record: Fields): Promise<Fields> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(record).map(
        async ([key, value]) =>
          [await redact(key), await walk(redact, value)] as const,
      ),
    ),
  );

const walk = async (redact: Redactor, value: unknown): Promise<unknown> => {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value))
    return Promise.all(value.map((each) => walk(redact, each)));
  return isFields(value) ? walkFields(redact, value) : value;
};

/** A JSON record with every key and every string in it, at any depth, passed through `redact`. */
export const redactFields = async (
  redact: Redact,
  record: Fields,
): Promise<Fields> =>
  redact === undefined ? record : walkFields(redact, record);

/**
 * `value` as it will be serialized, with every key and string passed through `redact`. It is turned
 * into plain JSON first, so a date or any other `toJSON` value is redacted in the form it is printed
 * in; redacting the value, not its JSON text, also catches a secret holding characters JSON escapes.
 */
export const redactValue = async (
  redact: Redact,
  value: unknown,
): Promise<unknown> => {
  if (redact === undefined) return value;
  const text: string | undefined = JSON.stringify(value);
  if (text === undefined) return undefined;
  const plain: unknown = JSON.parse(text);
  return walk(redact, plain);
};

export type { Infer };
