import { arch, hostname, platform, release } from "node:os"

import { isOmoTelemetryEnabled } from "@oh-my-opencode/omo-config-core"
import { shouldDisableTelemetry } from "@oh-my-opencode/telemetry-core"

import { loadSenpiOmoConfig } from "../config-resolution"
import { getOmoNativeAttribution, hashSessionId } from "../telemetry/product-identity"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { blankConfigSecrets, engineLogText, transcriptText } from "./collect"
import type { CollectedSection } from "./draft"

export interface HostSessionView {
  readonly cwd?: string
  readonly sessionId?: string
  readonly model?: string
  readonly entries: readonly unknown[]
}

export interface HostFacts {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly omoVersion: string
  readonly senpiVersion: string
  readonly channel: string
  readonly now: Date
  readonly session?: HostSessionView
}

export interface HostCollection {
  readonly sections: readonly CollectedSection[]
  readonly installHash?: string
  readonly sessionHash?: string
}

const locale = (): string => Intl.DateTimeFormat().resolvedOptions().locale

/** What the identity-hash gate reads: the env and the session's cwd (its omo config scope). */
export type IdentityHashConsentFacts = Pick<HostFacts, "env"> & { readonly session?: Pick<HostSessionView, "cwd"> }

const telemetryAllowed = (facts: IdentityHashConsentFacts, config: unknown): boolean =>
  !shouldDisableTelemetry({ env: { ...facts.env }, productEnvPrefix: "OMO_NATIVE" }) &&
  isOmoTelemetryEnabled(config as Parameters<typeof isOmoTelemetryEnabled>[0])

const loadConfig = (facts: IdentityHashConsentFacts) =>
  loadSenpiOmoConfig({
    env: { ...facts.env },
    ...(facts.session?.cwd === undefined ? {} : { cwd: facts.session.cwd }),
  })

const hashesAllowedFor = (facts: IdentityHashConsentFacts, loaded: ReturnType<typeof loadConfig>): boolean =>
  loaded.diagnostics.length === 0 && telemetryAllowed(facts, loaded.config)

/**
 * The one gate for the install and session hashes, read fresh from the env and the omo config on disk. `prepare`
 * collects the hashes through it and `submit` asks it again, so consent withdrawn in between is honored (#11638).
 */
export function identityHashesAllowed(facts: IdentityHashConsentFacts): boolean {
  return hashesAllowedFor(facts, loadConfig(facts))
}

export function collectHostSections(facts: HostFacts): HostCollection {
  const loaded = loadConfig(facts)
  const hashesAllowed = hashesAllowedFor(facts, loaded)
  const installHash = hashesAllowed ? getOmoNativeAttribution({ env: { ...facts.env } }).install_hash : undefined
  const sessionHash =
    hashesAllowed && facts.session?.sessionId !== undefined ? hashSessionId(facts.session.sessionId, facts.env) : undefined

  const identity = [
    `device    ${hostname()}`,
    ...(installHash === undefined ? [] : [`install   ${installHash}`]),
    ...(sessionHash === undefined ? [] : [`session   ${sessionHash}`]),
  ].join("\n")
  const environment = [
    `omo ${facts.omoVersion} · senpi ${facts.senpiVersion} · bun ${process.versions.bun ?? "none"} · node ${process.versions.node}`,
    `${platform()} ${release()} · ${arch()} · ${locale()} · ${facts.channel} channel`,
    `reported ${facts.now.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  ].join("\n")

  const sections: CollectedSection[] = [
    { id: "identity", text: identity, verbatim: true },
    { id: "environment", text: environment },
    { id: "config", text: JSON.stringify(blankConfigSecrets(loaded.config), null, 2) },
  ]
  const logs = engineLogText(resolveAgentHome({ env: facts.env }), facts.now)
  if (logs !== "") sections.push({ id: "logs", text: logs })
  if (facts.session !== undefined) {
    const header = [
      `session ${facts.session.sessionId ?? "unknown"} · model ${facts.session.model ?? "unknown"}`,
      `cwd ${facts.session.cwd ?? "unknown"}`,
    ].join("\n")
    sections.push({ id: "session", text: `${header}\n${transcriptText(facts.session.entries)}` })
  }
  return {
    sections,
    ...(installHash === undefined ? {} : { installHash }),
    ...(sessionHash === undefined ? {} : { sessionHash }),
  }
}
