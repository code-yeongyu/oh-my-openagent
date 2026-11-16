// The crate's fake EIS server (`omo-fake-eis`, crates/omo-computer-backend-wayland/examples) as
// a scenario process. sway and weston serve no EIS socket, so the Wayland sessions point
// LIBEI_SOCKET at `<runtime>/eis/eis-fake` and a scenario starts the fake there with the keymap
// `xkbcli` compiled. The fake's observer log (`fake-eis.json`, rewritten every 50 ms by the
// fake itself, never by the engine) is the scenario's independent oracle for what reached libei.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { targetDir } from "../lib/engine-bin.ts"
import type { JsonObject } from "../lib/engine.ts"
import { until } from "../lib/procs.ts"
import type { Context } from "../lib/scenario.ts"

export type FakeMode = "serve" | "drop-once" | "second-client-refused"

export interface FakeEis {
  /**
   * The fake's observer log as the fake wrote it AFTER this call: the fake rewrites the file
   * every 50 ms, so a read waits for the next rewrite instead of returning an older snapshot.
   */
  read(): Promise<JsonObject>
  /** Stops the fake and removes its socket directory. */
  stop(): Promise<void>
}

export interface Keymap {
  readonly file: string
  /** The group names the keymap declares, in group order (read from the file, not the engine). */
  readonly groups: readonly string[]
}

/** A numeric member of the fake's log; NaN when the member is missing, so no check passes on it. */
export function count(log: JsonObject, key: string): number {
  const value = log[key]
  return typeof value === "number" ? value : Number.NaN
}

function fakeEisBinary(): string {
  const built = spawnSync(
    "cargo",
    ["build", "-p", "omo-computer-backend-wayland", "--example", "omo-fake-eis", "--features", "fake", "--locked"],
    { stdio: "inherit" },
  )
  if (built.status !== 0) throw new Error("cargo build of the omo-fake-eis example failed")
  const binary = join(targetDir(), "debug", "examples", "omo-fake-eis")
  if (!existsSync(binary)) throw new Error(`the fake EIS binary is not at ${binary}`)
  return binary
}

/** Compiles the keymap for `layouts` (comma-separated) with xkbcli and reads its group names. */
export async function compileKeymap(ctx: Context, layouts: string): Promise<Keymap> {
  const text = await ctx.procs.stdout(["xkbcli", "compile-keymap", "--layout", layouts], ctx.stage.env)
  const file = join(ctx.stage.runDir, `keymap-${layouts.replaceAll(",", "-")}.xkb`)
  writeFileSync(file, `${text}\n`)
  const symbols = text.slice(text.indexOf("xkb_symbols"))
  const groups = [...symbols.matchAll(/^\s*name\[(?:Group)?(\d+)\]\s*=\s*"([^"]*)"/gm)]
    .map((match) => ({ index: Number(match[1]), name: match[2] ?? "" }))
    .sort((left, right) => left.index - right.index)
    .map(({ name }) => name)
  return { file, groups }
}

/** Starts the fake at the session's LIBEI_SOCKET and waits until it listens and logs. */
export async function startFakeEis(
  ctx: Context,
  keymap: Keymap,
  mode: FakeMode,
  regions: readonly string[],
): Promise<FakeEis> {
  const socket = ctx.stage.env.LIBEI_SOCKET
  if (socket === undefined) throw new Error(`session ${ctx.stage.session} names no LIBEI_SOCKET`)
  const dir = dirname(socket)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const child = ctx.procs.start("fake-eis", [fakeEisBinary(), dir, keymap.file, mode, ...regions], ctx.stage.env)
  const logFile = join(dir, "fake-eis.json")
  await until(() => existsSync(socket) && existsSync(logFile), "the fake EIS to listen and write its log")
  return {
    async read() {
      const since = statSync(logFile).mtimeMs
      await until(() => statSync(logFile).mtimeMs > since, "the fake EIS to rewrite its log")
      return JSON.parse(readFileSync(logFile, "utf8")) as JsonObject
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
        child.kill("SIGKILL")
        await exited
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
