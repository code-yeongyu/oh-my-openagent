// The text `--help` prints: the overview of a surface or a group, one operation's flags, and the
// `mcp` command. It is built from the surface definition and the caller's label, and the command
// line prints it through its redactor like everything else.
import { propertiesOf, typeLabel } from "./flags.ts";
import { toolName } from "./mcp.ts";
import {
  isOp,
  type AnyOp,
  type Ops,
  type SurfaceDefinition,
} from "./surface.ts";

const firstLine = (text: string): string => text.split("\n")[0] ?? "";

const listing = (
  ops: Ops,
  prefix: readonly string[],
  depth: number,
): string[] =>
  Object.entries(ops).flatMap(([name, value]) => {
    const path = [...prefix, name].join(" ");
    return isOp(value)
      ? [`  ${path.padEnd(28)} ${firstLine(value.description)}`]
      : depth > 0
        ? listing(value, [...prefix, name], depth - 1)
        : [
            `  ${path.padEnd(28)} (${Object.keys(value).length} commands: ${path} --help)`,
          ];
  });

export const overview = (
  surface: SurfaceDefinition<Ops>,
  cli: string,
  ops: Ops,
  prefix: readonly string[],
): string =>
  [
    prefix.length === 0
      ? `${surface.name} ${surface.version}${surface.description === undefined ? "" : `: ${surface.description}`}`
      : `${cli} ${prefix.join(" ")}`,
    "",
    `usage: ${cli} ${[...prefix, "<command>"].join(" ")} [--flags | --json '{...}' | --input file]`,
    "",
    "commands:",
    ...listing(ops, prefix, prefix.length === 0 ? 0 : 1),
    ...(prefix.length === 0
      ? [
          `  ${"mcp".padEnd(28)} serve every command as an MCP server (mcp --help)`,
        ]
      : []),
  ].join("\n");

export const opHelp = (
  cli: string,
  path: readonly string[],
  op: AnyOp,
): string => {
  const flags = propertiesOf(op.input.json).map((each) => {
    const said =
      typeof each.schema["description"] === "string"
        ? each.schema["description"]
        : "";
    const secret =
      each.schema["writeOnly"] === true ? "(secret: --input only) " : "";
    return `  --${`${each.flag} <${typeLabel(each.schema)}>`.padEnd(34)} ${each.required ? "(required) " : ""}${secret}${firstLine(said)}`;
  });
  const hints = Object.entries(op.annotations ?? {})
    .filter(([, on]) => on)
    .map(([hint]) => hint);
  return [
    `${cli} ${path.join(" ")}: ${op.description}`,
    "",
    ...(flags.length === 0 ? ["takes no input"] : ["flags:", ...flags]),
    "  --json <object>, --input <file|->    the whole input as JSON; flags override its fields",
    "",
    `mcp tool: ${toolName(path)}${hints.length === 0 ? "" : ` (${hints.join(", ")})`}`,
  ].join("\n");
};

export const mcpHelp = (cli: string): string =>
  [
    `usage: ${cli} mcp [--http --token-env NAME] [--host 127.0.0.1] [--port 0] [--path /mcp]`,
    "                  [--read-only] [--only pattern,...] [--exclude pattern,...]",
    "",
    "stdio by default (one JSON-RPC message per line). --http serves Streamable HTTP and prints",
    "its URL on stderr. It is plain HTTP, so it serves loopback only and every request must carry",
    "`Authorization: Bearer <the value of $NAME>` (--token-env NAME is required with --http).",
    "Speaks MCP 2026-07-28 (stateless) and the initialize-based revisions back to 2024-11-05.",
  ].join("\n");
