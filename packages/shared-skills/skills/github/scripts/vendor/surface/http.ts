// The Streamable HTTP binding, JSON responses only (no operation streams). Modern requests are
// checked against the MCP-Protocol-Version, Mcp-Method and Mcp-Name headers; a request without
// modern `_meta` is served under legacy semantics with no session, which those revisions allow.
// It speaks plain HTTP, so it binds to loopback only, refuses a foreign Origin (DNS rebinding) and
// requires a bearer token on every request: without one, any local process, another user's
// included, could run the surface's operations with this process's credentials.
import { createHash, timingSafeEqual } from "node:crypto";
import { ERRORS, type McpHandler, type Reply } from "./mcp.ts";
import { SurfaceError } from "./surface.ts";

export type HttpOptions = {
  readonly hostname?: string;
  readonly port?: number;
  readonly path?: string;
  /** Required on every request as `Authorization: Bearer <token>`. */
  readonly token: string;
};

export type HttpServer = {
  readonly url: string;
  readonly stop: () => Promise<void>;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const META_VERSION = "io.modelcontextprotocol/protocolVersion";

const isObject = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decoded = (header: string): string => {
  const match = /^=\?base64\?(.*)\?=$/s.exec(header);
  return match === null
    ? header
    : Buffer.from(match[1] ?? "", "base64").toString("utf8");
};

const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const refuse = (
  id: unknown,
  status: number,
  code: number,
  message: string,
): Response =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

const statusOf = (reply: Reply, modern: boolean): number => {
  const error = reply["error"];
  if (!modern || !isObject(error)) return 200;
  if (error["code"] === ERRORS.methodNotFound) return 404;
  const malformed = [
    ERRORS.invalidParams,
    ERRORS.unsupportedVersion,
    ERRORS.headerMismatch,
  ];
  return malformed.some((code) => code === error["code"]) ? 400 : 200;
};

const headerProblem = (
  request: Request,
  message: { readonly [key: string]: unknown },
): string | undefined => {
  const params = isObject(message["params"]) ? message["params"] : {};
  const meta = isObject(params["_meta"]) ? params["_meta"] : {};
  const version = request.headers.get("mcp-protocol-version");
  if (version !== meta[META_VERSION])
    return "MCP-Protocol-Version header does not match _meta";
  if (request.headers.get("mcp-method") !== message["method"])
    return "Mcp-Method header does not match the body";
  const named = message["method"] === "tools/call";
  const name = request.headers.get("mcp-name");
  if (named && (name === null || decoded(name) !== params["name"]))
    return "Mcp-Name header does not match params.name";
  return undefined;
};

const originAllowed = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
};

const digest = (text: string): Buffer =>
  createHash("sha256").update(text).digest();

export const serveHttp = (
  handler: McpHandler,
  options: HttpOptions,
): HttpServer => {
  const hostname = options.hostname ?? "127.0.0.1";
  const path = options.path ?? "/mcp";
  if (!LOOPBACK.has(hostname)) {
    throw new SurfaceError(
      "usage",
      `serving on ${hostname} is refused: only loopback is served, because this is plain HTTP`,
      "bind 127.0.0.1 and reach it through an SSH tunnel or a proxy that terminates TLS",
    );
  }
  // Checked at run time as well: a caller without the types must not end up serving "Bearer undefined".
  const token: unknown = options.token;
  if (typeof token !== "string" || token === "") {
    throw new SurfaceError(
      "usage",
      "the HTTP server needs a bearer token",
      "set one with --token-env NAME",
    );
  }
  const expected = digest(`Bearer ${token}`);
  const authorized = (request: Request): boolean =>
    timingSafeEqual(
      digest(request.headers.get("authorization") ?? ""),
      expected,
    );
  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    // Whatever a handler throws stays in this process: the default error page would print it.
    error: () => refuse(null, 500, ERRORS.internal, "Internal error"),
    fetch: async (request) => {
      if (new URL(request.url).pathname !== path)
        return new Response("not found", { status: 404 });
      if (!originAllowed(request))
        return refuse(null, 403, ERRORS.invalidRequest, "Origin not allowed");
      if (!authorized(request)) {
        return new Response("unauthorized", {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        });
      }
      if (request.method !== "POST")
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      let message: unknown;
      try {
        message = await request.json();
      } catch {
        return refuse(null, 400, ERRORS.parse, "Parse error");
      }
      if (!isObject(message))
        return refuse(null, 400, ERRORS.invalidRequest, "Invalid Request");
      const params = isObject(message["params"]) ? message["params"] : {};
      const modern =
        isObject(params["_meta"]) && META_VERSION in params["_meta"];
      if (modern) {
        const problem = headerProblem(request, message);
        // This reply echoes the caller's id and never reaches the handler, so it is redacted here.
        if (problem !== undefined)
          return json(
            await handler.redact({
              jsonrpc: "2.0",
              id: message["id"] ?? null,
              error: {
                code: ERRORS.headerMismatch,
                message: `Header mismatch: ${problem}`,
              },
            }),
            400,
          );
      }
      const reply = await handler.handle(message, {
        legacy: modern ? undefined : "stateless",
      });
      if (reply === undefined) return new Response(null, { status: 202 });
      return json(reply, statusOf(reply, modern));
    },
  });
  return {
    url: `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${server.port}${path}`,
    stop: () => server.stop(true),
  };
};
