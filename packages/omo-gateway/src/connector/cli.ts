// `omo gateway connect --scope <id> [--surface <platform>] [--once] [--shadow] [--sink stdout]
// [--foreground] [--adapter-module <file>]`, loaded lazily by packages/omo-native/bin/lib/gateway.js
// after it resolved and validated the user's `gateway` section.
//
// The surface's platform picks the built-in adapter (Slack, Discord, Telegram), imported lazily;
// `--adapter-module <file>` (a module exporting `createAdapter`) replaces it, for tests and for
// platforms without a built-in adapter yet.
// Foreground (`--sink stdout`, `--foreground`, `--once`): this process is the connector, or it
// prints the live holder and exits 0. Otherwise it ensures one: attach to a live holder or spawn a
// detached connector whose JSON lines go to `<agentDir>/gateway/connectors/<name>.log`.
// Exit codes: 0 ran/attached/started, 1 runtime failure or stopped on a refused account,
// 2 usage, config or credential refusal.

import { isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { SurfaceAdapter } from "../adapter/contract"
import { builtinAdapterFactory, hasBuiltinAdapter } from "./builtin"
import { CredentialsRefused, resolveCredentials, type ConnectorSurface, type Credentials } from "./credentials"
import { closeSync, writeSync } from "@oh-my-opencode/memory-core/fs"
import { ensureConnector, EnsureConnectorFailed, READY_FD_ENV } from "./ensure"
import type { LockDecision } from "./host"
import { runConnectorHost } from "./host"
import { connectorName } from "./lock"
import { jsonLinesSink, SHADOW_TAG, EVENT_TAG, type LineWriter } from "./sink"
import { adapterBuilder } from "./rebuild"
import { parseConnectArgs, selectSurface, type ConnectArgs } from "./select"

export type AdapterFactoryInput = {
  scope: string
  surface: ConnectorSurface
  credentials: Credentials
  /** `<agentDir>`: where an adapter keeps its own state files (under gateway/connectors/) */
  agentDir: string
  log: (line: string) => void
}
export type AdapterFactory = (input: AdapterFactoryInput) => SurfaceAdapter | Promise<SurfaceAdapter>

type Writer = LineWriter & { write(chunk: string): boolean }

export type SignalSource = {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown
  off(event: "SIGTERM" | "SIGINT", listener: () => void): unknown
}

export type ConnectContext = {
  gateway: unknown
  agentDir: string
  env: Readonly<Record<string, string | undefined>>
  home: string
  stdout: Writer
  stderr: Writer
  /** argv prefix that re-runs `omo gateway connect` (the detached connector's command) */
  launch: readonly string[]
  signals?: SignalSource
  /** the user config file the section came from; a connector stopped on a refused account restarts when it changes */
  configPath?: string
  /** re-read and re-validate the gateway section (after the config file changed) */
  reloadGateway?: () => Promise<unknown>
}

export const CONNECT_EXIT = { ok: 0, failed: 1, refused: 2 } as const

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The ensure parent asked for one readiness line on an inherited fd; write it once and close it. */
function readinessReporter(env: ConnectContext["env"], log: (line: string) => void): (decision: LockDecision) => void {
  const raw = env[READY_FD_ENV]
  const fd = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isSafeInteger(fd) || fd < 3) return () => undefined
  return (decision) => {
    try {
      writeSync(fd, `${decision.kind} ${decision.pid}\n`)
      closeSync(fd)
    } catch (error) {
      log(`could not report readiness to the starter: ${message(error)}`)
    }
  }
}

async function loadAdapterFactory(path: string): Promise<AdapterFactory> {
  const loaded: unknown = await import(pathToFileURL(path).href)
  const factory: unknown = loaded !== null && typeof loaded === "object" ? Reflect.get(loaded, "createAdapter") : undefined
  if (typeof factory !== "function") throw new Error(`${path} does not export createAdapter`)
  return (input) => Reflect.apply(factory, undefined, [input])
}

export async function runConnectCommand(argv: readonly string[], ctx: ConnectContext): Promise<number> {
  const fail = (text: string, code: number): number => {
    ctx.stderr.write(`omo gateway connect: ${text}\n`)
    return code
  }
  const parsed = parseConnectArgs(argv)
  if (parsed.kind === "error") return fail(parsed.message, CONNECT_EXIT.refused)
  const args = parsed.args
  const selected = selectSurface(ctx.gateway, args)
  if (selected.kind === "error") return fail(selected.message, CONNECT_EXIT.refused)
  const { scope, surface, account_id } = selected
  const name = connectorName(surface.platform, account_id)

  let credentials: Credentials
  try {
    credentials = await resolveCredentials(surface, { env: ctx.env, home: ctx.home })
  } catch (error) {
    if (error instanceof CredentialsRefused) return fail(error.message, CONNECT_EXIT.refused)
    throw error
  }
  const adapterModule = args.adapterModule === null ? null : isAbsolute(args.adapterModule) ? args.adapterModule : resolve(args.adapterModule)
  if (adapterModule === null && !hasBuiltinAdapter(surface.platform)) {
    return fail(`no built-in ${surface.platform} adapter yet; pass --adapter-module <file>`, CONNECT_EXIT.refused)
  }

  if (!args.foreground) return await ensureDetached(ctx, args, { scope, surface, account_id, name, adapterModule })

  let factory: AdapterFactory
  try {
    factory = adapterModule === null ? await builtinAdapterFactory(surface.platform) : await loadAdapterFactory(adapterModule)
  } catch (error) {
    const what = adapterModule === null ? `the built-in ${surface.platform} adapter` : "the adapter module"
    return fail(`cannot load ${what}: ${message(error)}`, CONNECT_EXIT.refused)
  }
  const log = (line: string) => {
    ctx.stderr.write(`gateway connector ${name}: ${line}\n`)
  }
  const builder = adapterBuilder({
    factory,
    args,
    scope,
    account_id,
    surface,
    credentials,
    agentDir: ctx.agentDir,
    env: ctx.env,
    home: ctx.home,
    configPath: ctx.configPath,
    reloadGateway: ctx.reloadGateway,
    log,
  })
  const controller = new AbortController()
  const signals = ctx.signals ?? process
  const stop = () => controller.abort()
  signals.on("SIGTERM", stop)
  signals.on("SIGINT", stop)
  try {
    const outcome = await runConnectorHost({
      agentDir: ctx.agentDir,
      scope,
      platform: surface.platform,
      account_id,
      createAdapter: builder.createAdapter,
      waitForChange: builder.waitForChange,
      notice: (text) => {
        ctx.stderr.write(`NOTICE ${text}\n`)
      },
      sink: jsonLinesSink(ctx.stdout, args.shadow ? SHADOW_TAG : EVENT_TAG),
      mode: args.shadow ? "shadow" : "live",
      once: args.once,
      signal: controller.signal,
      log,
      onLock: readinessReporter(ctx.env, log),
    })
    if (outcome.kind === "attached") {
      ctx.stdout.write(`attached: connector ${name} is held by pid ${outcome.holder.pid} (since ${outcome.holder.started_at})\n`)
      return CONNECT_EXIT.ok
    }
    const refused = outcome.fatal === null ? "" : `, stopped on a refused account (${outcome.fatal})`
    ctx.stderr.write(`gateway connector ${name}: stopped after ${outcome.emitted} events, ${outcome.restarts} restarts${refused}\n`)
    return outcome.fatal === null ? CONNECT_EXIT.ok : CONNECT_EXIT.failed
  } catch (error) {
    return fail(message(error), CONNECT_EXIT.failed)
  } finally {
    signals.off("SIGTERM", stop)
    signals.off("SIGINT", stop)
  }
}

async function ensureDetached(
  ctx: ConnectContext,
  args: ConnectArgs,
  target: { scope: string; surface: ConnectorSurface; account_id: string; name: string; adapterModule: string | null },
): Promise<number> {
  const command = [
    ...ctx.launch,
    "--scope",
    target.scope,
    "--surface",
    target.surface.platform,
    "--foreground",
    ...(args.shadow ? ["--shadow"] : []),
    ...(target.adapterModule === null ? [] : ["--adapter-module", target.adapterModule]),
  ]
  try {
    const outcome = await ensureConnector({
      agentDir: ctx.agentDir,
      platform: target.surface.platform,
      account_id: target.account_id,
      command,
      env: ctx.env,
    })
    if (outcome.action === "attached") ctx.stdout.write(`attached: connector ${target.name} is held by pid ${outcome.pid}\n`)
    else ctx.stdout.write(`started connector ${target.name} (pid ${outcome.pid}), log ${outcome.log}\n`)
    return CONNECT_EXIT.ok
  } catch (error) {
    if (!(error instanceof EnsureConnectorFailed)) throw error
    ctx.stderr.write(`omo gateway connect: ${error.message}\n`)
    return CONNECT_EXIT.failed
  }
}
