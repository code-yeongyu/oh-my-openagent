// How a surface's operations become MCP tools: names, schemas, behaviour hints, and which of
// them a server exposes.
import {
  entries,
  type Entry,
  type Ops,
  type SurfaceDefinition,
} from "./surface.ts";
import type { JsonSchema } from "./schema.ts";

export type McpOptions = {
  /** Serve only operations annotated readOnly. */
  readonly readOnly?: boolean;
  /** Serve only tools whose name matches one of these patterns (`*` is a wildcard). */
  readonly only?: readonly string[];
  /** Leave out tools whose name matches one of these patterns. */
  readonly exclude?: readonly string[];
};

export type Tool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations: JsonSchema;
};

/** The MCP tool name of an operation path: `["workspace", "move"]` is `workspace_move`. */
export const toolName = (path: readonly string[]): string => path.join("_");

const matches = (patterns: readonly string[], name: string): boolean =>
  patterns.some((pattern) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    ).test(name),
  );

const objectSchema = (schema: JsonSchema): JsonSchema =>
  schema["type"] === "object"
    ? schema
    : { type: "object", additionalProperties: false };

export const toolOf = ({ path, op }: Entry): Tool => {
  const hints = op.annotations ?? {};
  const output = op.output?.json;
  return {
    name: toolName(path),
    ...(op.title === undefined ? {} : { title: op.title }),
    description: op.description,
    inputSchema: objectSchema(op.input.json),
    ...(output !== undefined && output["type"] === "object"
      ? { outputSchema: output }
      : {}),
    annotations: {
      ...(op.title === undefined ? {} : { title: op.title }),
      readOnlyHint: hints.readOnly === true,
      destructiveHint: hints.readOnly !== true && hints.destructive !== false,
      idempotentHint: hints.idempotent === true,
      openWorldHint: hints.openWorld === true,
    },
  };
};

/** The operations a server with `options` exposes, in definition order. */
export const servedEntries = (
  surface: SurfaceDefinition<Ops>,
  options: McpOptions,
): readonly Entry[] =>
  entries(surface.ops).filter(({ path, op }) => {
    const name = toolName(path);
    if (options.readOnly === true && op.annotations?.readOnly !== true)
      return false;
    if (options.only !== undefined && !matches(options.only, name))
      return false;
    return !(options.exclude !== undefined && matches(options.exclude, name));
  });
