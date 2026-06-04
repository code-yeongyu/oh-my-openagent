import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { Writable } from "node:stream";

type StdioMode = "pipe" | "inherit" | "ignore";
type StdioTuple = [StdioMode, StdioMode, StdioMode];

export interface SpawnOptions {
  readonly cmd?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: StdioMode;
  readonly stdout?: StdioMode;
  readonly stderr?: StdioMode;
  readonly stdio?: StdioTuple;
  readonly detached?: boolean;
  readonly signal?: AbortSignal;
}

export interface SpawnedProcess {
  readonly exitCode: number | null;
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly stderr: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly stdin: NodeJS.WritableStream;
  readonly pid: number | undefined;
  kill(signal?: NodeJS.Signals): void;
  ref(): void;
  unref(): void;
}

export interface SpawnSyncResult {
  readonly exitCode: number;
  readonly stdout: Buffer | undefined;
  readonly stderr: Buffer | undefined;
  readonly success: boolean;
  readonly pid: number;
}

type BunSpawnRuntime = {
  spawn(command: readonly string[], options?: SpawnOptions): BunSpawnedProcess;
  spawn(options: SpawnOptions & { readonly cmd: readonly string[] }): BunSpawnedProcess;
  spawnSync(command: readonly string[], options?: SpawnOptions): SpawnSyncResult;
  spawnSync(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnSyncResult;
};

type BunSpawnedProcess = Omit<SpawnedProcess, "stdout" | "stderr"> & {
  readonly stdout?: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly stderr?: ReadableStream<Uint8Array<ArrayBuffer>>;
};

const runtime = globalThis as typeof globalThis & { readonly Bun?: BunSpawnRuntime };
const IS_BUN = typeof runtime.Bun !== "undefined";

function emptyReadableStream(): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.close();
    },
  });
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array<ArrayBuffer>> {
  if (!stream) return emptyReadableStream();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          controller.enqueue(toUint8Array(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function toUint8Array(chunk: unknown): Uint8Array<ArrayBuffer> {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  return new TextEncoder().encode(String(chunk));
}

function emptyWritableStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function isOptionsWithCommand(value: unknown): value is SpawnOptions & { readonly cmd: readonly string[] } {
  return typeof value === "object" && value !== null && "cmd" in value && Array.isArray(value.cmd);
}

function resolveCommand(cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }), optsArg?: SpawnOptions): { readonly cmd: readonly string[]; readonly opts: SpawnOptions } {
  if (isOptionsWithCommand(cmdOrOpts)) return { cmd: cmdOrOpts.cmd, opts: cmdOrOpts };
  return { cmd: cmdOrOpts, opts: optsArg ?? {} };
}

function resolveStdio(options: SpawnOptions): StdioTuple {
  if (options.stdio) return options.stdio;
  return [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "inherit"];
}

function wrapNodeProcess(proc: ReturnType<typeof nodeSpawn>): SpawnedProcess {
  let exitCode: number | null = null;
  const exited = new Promise<number>((resolve, reject) => {
    proc.on("exit", (code) => {
      exitCode = code ?? 1;
      resolve(exitCode);
    });
    proc.on("error", (error) => {
      if (exitCode === null) {
        exitCode = 1;
        reject(error);
      }
    });
  });
  return {
    get exitCode() {
      return exitCode;
    },
    exited,
    stdout: toReadableStream(proc.stdout),
    stderr: toReadableStream(proc.stderr),
    stdin: proc.stdin ?? emptyWritableStream(),
    pid: proc.pid,
    kill(signal?: NodeJS.Signals) {
      if (proc.killed || exitCode !== null) return;
      proc.kill(signal);
    },
    ref() {
      proc.ref();
    },
    unref() {
      proc.unref();
    },
  };
}

function wrapBunProcess(proc: BunSpawnedProcess): SpawnedProcess {
  return {
    ...proc,
    stdout: proc.stdout ?? emptyReadableStream(),
    stderr: proc.stderr ?? emptyReadableStream(),
  };
}

export function spawn(command: readonly string[], options?: SpawnOptions): SpawnedProcess;
export function spawn(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnedProcess;
export function spawn(cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }), opts?: SpawnOptions): SpawnedProcess {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts);
  if (IS_BUN) return wrapBunProcess(runtime.Bun.spawn(cmd, options));
  const [bin, ...args] = cmd;
  if (!bin) throw new Error("spawn requires a command");
  return wrapNodeProcess(nodeSpawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: resolveStdio(options),
    detached: options.detached,
    signal: options.signal,
  }));
}

export function spawnSync(command: readonly string[], options?: SpawnOptions): SpawnSyncResult;
export function spawnSync(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnSyncResult;
export function spawnSync(cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }), opts?: SpawnOptions): SpawnSyncResult {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts);
  if (IS_BUN) return runtime.Bun.spawnSync(cmd, options);
  const [bin, ...args] = cmd;
  if (!bin) throw new Error("spawnSync requires a command");
  const result = nodeSpawnSync(bin, args, { cwd: options.cwd, env: options.env, stdio: resolveStdio(options) });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? undefined,
    stderr: result.stderr ?? undefined,
    success: (result.status ?? 1) === 0,
    pid: result.pid ?? -1,
  };
}
