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

const telemetryAllowed = (facts: HostFacts, config: unknown): boolean =>
  !shouldDisableTelemetry({ env: { ...facts.env }, productEnvPrefix: "OMO_NATIVE" }) &&
  isOmoTelemetryEnabled(config as Parameters<typeof isOmoTelemetryEnabled>[0])

export function collectHostSections(facts: HostFacts): HostCollection {
  const loaded = loadSenpiOmoConfig({
    env: { ...facts.env },
    ...(facts.session?.cwd === undefined ? {} : { cwd: facts.session.cwd }),
  })
  const hashesAllowed = loaded.diagnostics.length === 0 && telemetryAllowed(facts, loaded.config)
  const installHash = hashesAllowed ? getOmoNativeAttribution({ env: { ...facts.env } }).install_hash : undefined
  const sessionHash =
    hashesAllowed && facts.session?.sessionId !== undefined ? hashSessionId(facts.session.sessionId) : undefined

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
