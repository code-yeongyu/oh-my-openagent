import type { MigrationPlan } from "@oh-my-opencode/omo-config-core"

import {
  openCodeRoutingGap,
  openCodeRoutingNotice,
  readEditionRouting,
} from "../../../../omo-native/bin/lib/setup-opencode-models.js"

export const OPENCODE_ROUTING_NOTICE_MIGRATION_ID = "2026-09-opencode-routing-notice"

type RoutingNoticePlanOptions = {
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
  readonly targetPath: string
}

function reported(document: Readonly<Record<string, unknown>>): boolean {
  const markers = document["_migrations"]
  return Array.isArray(markers) && markers.includes(OPENCODE_ROUTING_NOTICE_MIGRATION_ID)
}

/**
 * Reports, once, the OpenCode edition's agent and category model settings Native does not use,
 * with the mapping `omo setup` applies. It writes nothing but its `_migrations` marker: the legacy
 * migration deliberately never copies those settings (#7270), and `omo setup` carries them with the
 * user's consent. Gated on content like the other in-place plans, so a config with nothing to
 * report gets no write and no marker.
 */
export function createOpenCodeRoutingNoticePlan(options: RoutingNoticePlanOptions): MigrationPlan {
  const gaps = new WeakMap<object, readonly string[]>()
  const gapOf = (document: Readonly<Record<string, unknown>>): readonly string[] => {
    const known = gaps.get(document)
    if (known !== undefined) return known
    const gap = openCodeRoutingGap(document, readEditionRouting({ env: options.environment, home: options.homeDir }))
    gaps.set(document, gap)
    return gap
  }
  return {
    id: OPENCODE_ROUTING_NOTICE_MIGRATION_ID,
    mode: "replace-target",
    shouldRun: (target) => !reported(target) && gapOf(target).length > 0,
    sources: [],
    targetPath: options.targetPath,
    transform: (sources) => {
      const target = sources[0]?.value
      const document = typeof target === "object" && target !== null && !Array.isArray(target) ? { ...target } : {}
      return { diagnostics: [openCodeRoutingNotice(gapOf(document))], document }
    },
  }
}
