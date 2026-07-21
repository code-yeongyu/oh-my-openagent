import { fileURLToPath } from "node:url"

import {
  sweepCodegraphZombies,
  sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemonVersions,
  type SweepCodegraphZombiesOptions,
  type SweepOrphanedLspDaemonProxiesOptions,
  type SweepStaleLspDaemonVersionsOptions,
} from "@oh-my-opencode/utils/process-sweep"

// Unconditional omo process hygiene for the opencode adapter (T16): plugin
// startup fires this family sweep fire-and-forget. There are deliberately NO
// config keys — hygiene always runs and each family self-throttles via its
// stamp file inside the sweep functions (passed through untouched here).
// Mirrors the codex sweepCodegraphZombiesBestEffort pattern
// (packages/omo-codex/plugin/components/codegraph/src/hook-sweep.ts).

export interface OmoFamilySweepOptions {
  readonly log?: (message: string) => void
}

export interface OmoFamilySweeps {
  readonly sweepCodegraph: typeof sweepCodegraphZombies
  readonly sweepLspProxies: typeof sweepOrphanedLspDaemonProxies
  readonly sweepStaleLspDaemons: typeof sweepStaleLspDaemonVersions
}

const defaultSweeps: OmoFamilySweeps = {
  sweepCodegraph: sweepCodegraphZombies,
  sweepLspProxies: sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemons: sweepStaleLspDaemonVersions,
}

export async function sweepCodegraphZombiesBestEffort(
  options: OmoFamilySweepOptions,
  sweep: typeof sweepCodegraphZombies = sweepCodegraphZombies,
): Promise<void> {
  try {
    const sweepOptions: SweepCodegraphZombiesOptions = {
      pluginRoot: defaultPluginRoot(),
      ...(options.log === undefined ? {} : { log: options.log }),
    }
    await sweep(sweepOptions)
  } catch (error) {
    options.log?.(`CodeGraph zombie sweep skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function sweepOrphanedLspDaemonProxiesBestEffort(
  options: OmoFamilySweepOptions,
  sweep: typeof sweepOrphanedLspDaemonProxies = sweepOrphanedLspDaemonProxies,
): Promise<void> {
  try {
    const sweepOptions: SweepOrphanedLspDaemonProxiesOptions = {
      pluginRoot: defaultPluginRoot(),
      ...(options.log === undefined ? {} : { log: options.log }),
    }
    await sweep(sweepOptions)
  } catch (error) {
    options.log?.(`lsp-daemon proxy sweep skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function sweepStaleLspDaemonVersionsBestEffort(
  options: OmoFamilySweepOptions,
  sweep: typeof sweepStaleLspDaemonVersions = sweepStaleLspDaemonVersions,
): Promise<void> {
  try {
    const sweepOptions: SweepStaleLspDaemonVersionsOptions = {
      ...(options.log === undefined ? {} : { log: options.log }),
    }
    await sweep(sweepOptions)
  } catch (error) {
    options.log?.(`lsp-daemon stale-version sweep skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Runs all three omo sweep families concurrently. NEVER rejects: each family
 * is wrapped best-effort so a sweep failure can only produce a log line, not
 * a startup failure. Callers fire-and-forget the returned promise.
 */
export async function sweepOmoFamiliesBestEffort(
  options: OmoFamilySweepOptions = {},
  sweeps: OmoFamilySweeps = defaultSweeps,
): Promise<void> {
  await Promise.all([
    sweepCodegraphZombiesBestEffort(options, sweeps.sweepCodegraph),
    sweepOrphanedLspDaemonProxiesBestEffort(options, sweeps.sweepLspProxies),
    sweepStaleLspDaemonVersionsBestEffort(options, sweeps.sweepStaleLspDaemons),
  ])
}

function defaultPluginRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url))
}
