// The MCP server for a surface, independent of transport. It is dual-era: a request carrying
// `_meta["io.modelcontextprotocol/protocolVersion"]` is served statelessly under the 2026-07-28
// revision (no handshake, `server/discover`), and an `initialize` request opens the legacy,
// handshake-based revisions (2025-11-25 and earlier) for the rest of that connection.
import {
  describeError,
  redactFields,
  redactValue,
  type SurfaceDefinition,
  type Ops,
} from "./surface.ts";
import { servedEntries, toolName, toolOf, type McpOptions } from "./tools.ts";

export { toolName, type McpOptions, type Tool } from "./tools.ts";

export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const META = "io.modelcontextprotocol/";

export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

type Message = { readonly [key: string]: unknown };
export type Reply = { readonly jsonrpc: "2.0"; readonly id: unknown } & Message;
/** Per connection: stdio has one, each legacy HTTP request is its own. */
export type Connection = { legacy: string | undefined };

const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class Refusal {
  readonly code: number;
  readonly message: string;
  constructor(code: number, message: string) {
    this.code = code;
    this.message = message;
  }
}

const failure = (
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): Reply => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

export const mcpHandler = <O extends Ops>(
  surface: SurfaceDefinition<O>,
  options: McpOptions = {},
) => {
  const served = servedEntries(surface, options);
  const byName = new Map(served.map((entry) => [toolName(entry.path), entry]));
  const tools = served.map(toolOf);
  const serverInfo = { name: surface.name, version: surface.version };
  const instructions =
    surface.instructions === undefined
      ? {}
      : { instructions: surface.instructions };

  const call = async (params: Message): Promise<Message | Refusal> => {
    const name = params["name"];
    const entry = typeof name === "string" ? byName.get(name) : undefined;
    if (entry === undefined)
      return new Refusal(ERRORS.invalidParams, `Unknown tool: ${String(name)}`);
    try {
      // Redacted before it is serialized, so the text and the structured copy carry the same value.
      const value = await redactValue(
        surface.redact,
        await entry.op.invoke(params["arguments"] ?? {}),
      );
      const text =
        value === undefined ? "null" : JSON.stringify(value, null, 2);
      return {
        content: [{ type: "text", text }],
        ...(isObject(value) ? { structuredContent: value } : {}),
        isError: false,
      };
    } catch (error) {
      const { kind, message, hint } = describeError(error);
      const said = `${kind}: ${message}${hint === undefined ? "" : `\nhint: ${hint}`}`;
      return { content: [{ type: "text", text: said }], isError: true };
    }
  };

  const serve = async (
    method: string,
    params: Message,
    modern: boolean,
  ): Promise<Message | Refusal> => {
    switch (method) {
      case "ping":
        return {};
      case "tools/list":
        return modern
          ? { tools, ttlMs: 300_000, cacheScope: "public" }
          : { tools };
      case "tools/call":
        return call(params);
      default:
        return new Refusal(
          ERRORS.methodNotFound,
          `Method not found: ${method}`,
        );
    }
  };

  const respond = (
    id: unknown,
    result: Message | Refusal,
    modern: boolean,
  ): Reply => {
    if (result instanceof Refusal)
      return failure(id, result.code, result.message);
    if (!modern) return { jsonrpc: "2.0", id, result };
    return {
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "complete",
        ...result,
        _meta: { [`${META}serverInfo`]: serverInfo },
      },
    };
  };

  const answer = async (
    message: unknown,
    connection: Connection,
  ): Promise<Reply | undefined> => {
    if (!isObject(message) || message["jsonrpc"] !== "2.0") {
      return failure(
        isObject(message) ? message["id"] : null,
        ERRORS.invalidRequest,
        "Invalid Request",
      );
    }
    const { id, method } = message;
    const params = isObject(message["params"]) ? message["params"] : {};
    if (typeof method !== "string") return undefined;
    if (!("id" in message)) return undefined;
    if (method === "initialize") {
      const asked = params["protocolVersion"];
      const version =
        LEGACY_VERSIONS.find((each) => each === asked) ?? LEGACY_VERSIONS[0];
      connection.legacy = version;
      return respond(
        id,
        {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          ...instructions,
        },
        false,
      );
    }
    const meta = isObject(params["_meta"]) ? params["_meta"] : {};
    const version = meta[`${META}protocolVersion`];
    if (version === undefined && connection.legacy !== undefined)
      return respond(id, await serve(method, params, false), false);
    if (
      typeof version !== "string" ||
      !isObject(meta[`${META}clientCapabilities`])
    ) {
      return failure(
        id,
        ERRORS.invalidParams,
        `Invalid params: _meta must carry ${META}protocolVersion and ${META}clientCapabilities (or send initialize first; supported: ${[...MODERN_VERSIONS, ...LEGACY_VERSIONS].join(", ")})`,
      );
    }
    if (!MODERN_VERSIONS.some((each) => each === version)) {
      return failure(
        id,
        ERRORS.unsupportedVersion,
        "Unsupported protocol version",
        { supported: [...MODERN_VERSIONS], requested: version },
      );
    }
    if (method === "server/discover") {
      return respond(
        id,
        {
          supportedVersions: [...MODERN_VERSIONS],
          capabilities: { tools: {} },
          ...instructions,
          ttlMs: 300_000,
          cacheScope: "public",
        },
        true,
      );
    }
    return respond(id, await serve(method, params, true), true);
  };

  /** A reply with the surface's redactor applied; a transport uses it for the replies it builds itself. */
  const redact = async (reply: Reply): Promise<Reply> => {
    const cleaned = await redactFields(surface.redact, reply);
    return { ...cleaned, jsonrpc: "2.0", id: cleaned["id"] };
  };

  /**
   * One JSON-RPC message in; the reply out, or undefined for a notification or a response. Every
   * reply passes the surface's redactor here, protocol errors that echo the caller's input included.
   */
  const handle = async (
    message: unknown,
    connection: Connection,
  ): Promise<Reply | undefined> => {
    const reply = await answer(message, connection);
    return reply === undefined ? undefined : redact(reply);
  };

  return { tools, handle, redact };
};

export type McpHandler = ReturnType<typeof mcpHandler>;
