// Vendored from sisyphuslabs/omo-relay-daemon@88e58154bb592d781446a62a3d8d912769675079 packages/local-api/src/powershell.ts
import { spawn } from "node:child_process";

// Running Windows PowerShell 5.1 for the DACL and level scripts, and reading the error line of a failed one.
export type PowerShellRunner = (
  script: string,
  env: { readonly [name: string]: string },
) => Promise<{ readonly code: number; readonly out: string; readonly err?: string }>;

// #1452: Windows PowerShell 5.1 resolves its own modules (Microsoft.PowerShell.Security, .Management, .Utility) from
// PSModulePath. A PowerShell 7 parent anywhere up the process chain leaves its module dirs first in that variable, and
// 5.1 then fails to load the 7.x copies. Without the variable 5.1 builds its default path, so it is never inherited.
const inheritedEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PSMODULEPATH"),
  );

export const runPowerShell: PowerShellRunner = async (script, env) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // node:child_process only: omo vendors this client and also runs it under Node (LA27).
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env: { ...inheritedEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (exitCode) => resolve(exitCode ?? -1));
  });
  // TextDecoder drops a leading UTF-8 BOM, as the earlier stream reader did (LA28).
  const decoder = new TextDecoder();
  return {
    code,
    out: decoder.decode(Buffer.concat(chunks)),
    err: decoder.decode(Buffer.concat(errChunks)),
  };
};

// #1452: the first line of a PowerShell error, read from the script's stderr. A redirected Windows PowerShell writes
// its error record as CLIXML: a progress object (no <S> text) and several <S S="Error"> elements whose line breaks are
// escaped as _x000D__x000A_. A plain-text error is wrapped over several lines and then followed by its position
// ("At line:", "+ ..."), which is dropped. Same reading as oh-my-openagent#14101's runner.
const XML_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

const clixmlText = (line: string): string =>
  [...line.matchAll(/<S(?: S="[^"]*")?>([^<]*)<\/S>/g)]
    .map((match) => match[1] ?? "")
    .join("")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => XML_ENTITIES[entity] ?? "");

const POSITION_LINE = /^(?:At line:\d|At .*char:\d|\+ )/;
const MAX_CHARS = 300;

export const powerShellError = (err: string | undefined): string => {
  const lines = (err ?? "")
    .split(/\r?\n/)
    .filter((text) => !text.trim().startsWith("#< CLIXML"))
    .flatMap((text) => (text.trim().startsWith("<") ? clixmlText(text).split(/\r?\n/) : [text]))
    .map((text) => text.trim())
    .filter((text) => text !== "");
  const end = lines.findIndex((text) => POSITION_LINE.test(text));
  return lines
    .slice(0, end === -1 ? lines.length : end)
    .join(" ")
    .slice(0, MAX_CHARS);
};
