import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { agentCells } from "@/components/landing/agents-data"
import { AgentsGrid, type AgentGridItem } from "@/components/landing/agents-grid"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"

/**
 * The 11 graph roles plus the dynamic agent as a gapless bento (DESIGN.md §5): Orchestrator 2x2,
 * Planner 2x1, the rest 1x1 - 16 units, no holes. Node ids are shared with the 3D
 * hero graph, so a focused node lights its cell (`data-active`).
 */
export async function AgentsSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing.agents")

  const items: readonly AgentGridItem[] = agentCells.map((cell) => {
    const key = cell.key
    const icon = <cell.icon />
    return {
      id: cell.id,
      name: t(`${key}.name`),
      role: t(`${key}.role`),
      model: t(`${key}.model`),
      icon,
      colSpan: cell.colSpan,
      rowSpan: cell.rowSpan,
      description: cell.colSpan === 2 && cell.rowSpan === 2 ? t(`${key}.description`) : undefined,
    }
  })

  return (
    <section
      id="agents"
      data-section="agents"
      aria-labelledby="agents-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="agents-title"
            eyebrow={t("eyebrow")}
            title={t("title")}
            intro={t("subtitle")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          <AgentsGrid items={items} aria-labelledby="agents-title" />
        </Reveal>
      </Frame>
    </section>
  )
}
