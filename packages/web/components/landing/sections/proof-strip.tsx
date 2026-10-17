import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { ProofStrip } from "@/components/landing/proof-strip"
import { Frame } from "@/components/ledger/frame"
import { FALLBACK_FORMATTED_STATS, formatStats, getStats } from "@/lib/stats"

/**
 * DESIGN.md §5 ProofStrip — server wrapper that seeds the live client strip. The hero →
 * proof strip separation uses `--space-40` (§4 section rhythm).
 */
export async function ProofStripSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  let stats = FALLBACK_FORMATTED_STATS
  try {
    stats = formatStats(await getStats())
  } catch {
    stats = FALLBACK_FORMATTED_STATS
  }

  return (
    <section
      data-section="proof"
      aria-label={t("proof.label")}
      className="pt-[var(--space-40)] pb-24"
    >
      <Frame>
        <Reveal>
          <ProofStrip
            initialStats={{
              stars: stats.stars,
              totalDownloads: stats.totalDownloads,
              monthlyDownloads: stats.monthlyDownloads,
              weeklyDownloads: stats.weeklyDownloads,
            }}
            labels={{
              githubStars: t("proof.githubStars"),
              totalDownloads: t("proof.totalDownloads"),
              monthlyDownloads: t("proof.monthlyDownloads"),
            }}
          />
        </Reveal>
      </Frame>
    </section>
  )
}
