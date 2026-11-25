// Types for the gateway kit members a TypeScript caller uses (script/qa/sdk-proof). The kit itself is plain ESM.
import type { EventEmitter } from "node:events"

export const ENGINE_VERSION: string
export const bus: EventEmitter

export type Scratch = {
  readonly label: string
  readonly dir: string
  readonly home: string
  readonly agentDir: string
  readonly work: string
  readonly env: Record<string, string>
}
export type OmoInstall = {
  readonly name: string
  readonly root: string
  readonly omoJs: string
  readonly plugin: string
  readonly patches: readonly { readonly patch: string; readonly file: string }[]
}
export type FakeModel = {
  readonly url: string
  readonly port: number
  readonly requests: unknown[]
  readonly heldTags: () => string[]
  readonly script: (name: string, calls: readonly { readonly name: string; readonly args: unknown }[]) => string
  readonly release: (tag: string) => boolean
  readonly stop: () => Promise<void>
}

export class EndpointClient {
  static connect(socketPath: string, label?: string): Promise<EndpointClient>
  readonly records: Record<string, unknown>[]
  readonly closed: boolean
  request(command: object, options?: { readonly timeoutMs?: number }): Promise<Record<string, unknown>>
  close(): void
}

export function installCleanupHooks(): void
export function cleanupAll(): Promise<void>
export function waitFor<T>(
  check: () => T | Promise<T>,
  options?: { readonly label?: string; readonly timeoutMs?: number },
): Promise<NonNullable<T>>
export function buildOmoInstall(name: string, patchNames?: readonly string[]): Promise<OmoInstall>
export function makeScratch(label: string, fake: FakeModel): Scratch
export function startFakeModel(options?: {
  readonly promptTokens?: (body: Readonly<Record<string, unknown>>) => number
}): Promise<FakeModel>
export function omo(
  scratch: Scratch,
  install: OmoInstall,
  args: readonly string[],
  options?: { readonly env?: Record<string, string>; readonly cwd?: string },
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string; readonly json: unknown }>
export function startShardHost(
  scratch: Scratch,
  install: OmoInstall,
  owner: string,
): Promise<{ readonly socket: string; readonly client: EndpointClient; readonly ensured: unknown }>
export function openHostSession(
  client: EndpointClient,
  cwd: string,
  extra?: object,
): Promise<{
  readonly routingId: string
  readonly durableId: string | undefined
  readonly sessionPath: string | undefined
}>
export function awaitToolResult(
  fake: FakeModel,
  tool: string,
  from: number,
  options?: { readonly timeoutMs?: number; readonly label?: string },
): Promise<unknown>
