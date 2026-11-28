// The command line a surface defines. `<group> <op> --flag value` runs an operation and prints
// its result as JSON; `--help` anywhere explains what is there; `mcp` serves the same operations
// as an MCP server (stdio by default, `--http` for Streamable HTTP).
import { parseArgs } from "node:util";
import { parseFlags } from "./flags.ts";
import { mcpHelp, opHelp, overview } from "./help.ts";
import { serveHttp } from "./http.ts";
import { mcpHandler, type McpOptions } from "./mcp.ts";
import { serveStdio } from "./stdio.ts";
import {
  describeError,
  internalError,
  isOp,
  redactValue,
  SurfaceError,
  type Ops,
  type SurfaceDefinition,
} from "./surface.ts";

export type CliIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly stdin: () => ReadableStream<Uint8Array>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Resolves when the HTTP server should stop (SIGINT or SIGTERM by default). */
  readonly stopped: () => Promise<void>;
};

const processIo = (): CliIo => ({
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  stdin: () => Bun.stdin.stream(),
  env: process.env,
  stopped: () =>
    new Promise((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    }),
});

type Say = (text: string) => Promise<void>;
/** The only way this command line writes a line of its own: through the redactor. */
type Voice = { readonly out: Say; readonly err: Say };

// The bearer the HTTP server will require is a secret of this process too. It is read leniently,
// before the arguments are validated, so that not even the error for a bad argument can print it.
const bearerOf = (
  argv: readonly string[],
  env: CliIo["env"],
): string | undefined => {
  const { values } = parseArgs({
    args: [...argv],
    options: { "token-env": { type: "string" } },
    strict: false,
  });
  const name = values["token-env"];
  const value = typeof name === "string" ? env[name] : undefined;
  return value === undefined || value === "" ? undefined : value;
};

const serveMcp = async (
  surface: SurfaceDefinition<Ops>,
  cli: string,
  argv: readonly string[],
  io: CliIo,
  say: Voice,
): Promise<number> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      http: { type: "boolean" },
      host: { type: "string" },
      port: { type: "string" },
      path: { type: "string" },
      "token-env": { type: "string" },
      "read-only": { type: "boolean" },
      only: { type: "string" },
      exclude: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) {
    await say.out(mcpHelp(cli));
    return 0;
  }
  const split = (text: string | undefined) =>
    text === undefined ? undefined : text.split(",").map((each) => each.trim());
  const only = split(values.only);
  const exclude = split(values.exclude);
  const options: McpOptions = {
    ...(values["read-only"] === true ? { readOnly: true } : {}),
    ...(only === undefined ? {} : { only }),
    ...(exclude === undefined ? {} : { exclude }),
  };
  const handler = mcpHandler(surface, options);
  if (values.http !== true) {
    // The protocol stream: each line is a reply the handler has already redacted.
    await serveStdio(handler, { input: io.stdin(), write: io.out });
    return 0;
  }
  const tokenName = values["token-env"];
  if (tokenName === undefined)
    throw new SurfaceError(
      "usage",
      "mcp --http needs --token-env NAME",
      "name an environment variable that holds the bearer token clients must send",
    );
  const token = io.env[tokenName] ?? "";
  if (token === "") throw new SurfaceError("usage", `$${tokenName} is empty`);
  const server = serveHttp(handler, {
    ...(values.host === undefined ? {} : { hostname: values.host }),
    ...(values.port === undefined ? {} : { port: Number(values.port) }),
    ...(values.path === undefined ? {} : { path: values.path }),
    token,
  });
  await say.err(
    `${surface.name} MCP server: ${server.url} (${handler.tools.length} tools)`,
  );
  await io.stopped();
  await server.stop();
  return 0;
};

/** Runs the command line `argv` (without the program name); resolves to the exit code. */
export const runCli = async <O extends Ops>(
  surface: SurfaceDefinition<O>,
  argv: readonly string[],
  given: Partial<CliIo> & { readonly cli?: string } = {},
): Promise<number> => {
  const io = { ...processIo(), ...given };
  const cli = given.cli ?? surface.name;
  const bearer =
    argv[0] === "mcp" ? bearerOf(argv.slice(1), io.env) : undefined;
  const redact = async (text: string): Promise<string> => {
    const hidden =
      bearer === undefined ? text : text.replaceAll(bearer, "[redacted]");
    return surface.redact === undefined ? hidden : surface.redact(hidden);
  };
  const say: Voice = {
    out: async (text) => io.out(await redact(text)),
    err: async (text) => io.err(await redact(text)),
  };
  try {
    // The server gets the same redactor, so its replies hide the bearer as well as the surface's secrets.
    if (argv[0] === "mcp")
      return await serveMcp(
        { ...surface, redact },
        cli,
        argv.slice(1),
        io,
        say,
      );
    let ops: Ops = surface.ops;
    const path: string[] = [];
    for (const word of argv) {
      if (word.startsWith("-")) break;
      const next = ops[word];
      if (next === undefined)
        throw new SurfaceError(
          "usage",
          `unknown command ${[...path, word].join(" ")}`,
          `run ${cli} ${path.join(" ")} --help`,
        );
      path.push(word);
      if (isOp(next)) {
        const rest = argv.slice(path.length);
        const parsed = await parseFlags(next.input.json, rest, () =>
          new Response(io.stdin()).text(),
        );
        if (parsed.help) {
          await say.out(opHelp(cli, path, next));
          return 0;
        }
        const result = await next.invoke(parsed.input);
        if (result !== undefined)
          await say.out(
            JSON.stringify(await redactValue(redact, result), null, 2),
          );
        return 0;
      }
      ops = next;
    }
    await say.out(overview(surface, cli, ops, path));
    return argv.length === path.length ||
      argv.includes("--help") ||
      argv.includes("-h")
      ? 0
      : 2;
  } catch (error) {
    // Any thrown value is wrapped, never rethrown, so its text still reaches the redactor; the
    // instanceof check itself is guarded, because it throws for a revoked or trapped Proxy.
    let reported: Error;
    try {
      reported = error instanceof Error ? error : internalError(error);
    } catch {
      reported = internalError(error);
    }
    const { kind, message, hint } = describeError(reported);
    await say.err(`error: ${kind}: ${message}`);
    if (hint !== undefined) await say.err(`hint: ${hint}`);
    return kind === "usage" ? 2 : 1;
  }
};
