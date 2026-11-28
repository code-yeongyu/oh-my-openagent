export { s, problems, conforms } from "./schema.ts";
export type {
  Doc,
  Infer,
  JsonSchema,
  ObjectOf,
  Schema,
  Shape,
} from "./schema.ts";
export {
  bind,
  defineSurface,
  describeError,
  entries,
  internalError,
  isOp,
  op,
  secretTally,
  SurfaceError,
} from "./surface.ts";
export type {
  Annotations,
  AnyOp,
  Client,
  Described,
  Entry,
  Op,
  Ops,
  SurfaceDefinition,
} from "./surface.ts";
export { runCli } from "./cli.ts";
export type { CliIo } from "./cli.ts";
export {
  ERRORS,
  LEGACY_VERSIONS,
  MODERN_VERSIONS,
  mcpHandler,
  toolName,
} from "./mcp.ts";
export type { Connection, McpHandler, McpOptions, Reply, Tool } from "./mcp.ts";
export { serveStdio } from "./stdio.ts";
export type { StdioStreams } from "./stdio.ts";
export { serveHttp } from "./http.ts";
export type { HttpOptions, HttpServer } from "./http.ts";
