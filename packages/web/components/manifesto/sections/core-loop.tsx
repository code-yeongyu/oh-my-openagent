import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { ManifestoSection, TITLE_CLASS } from "@/components/manifesto/manifesto-section"

const CORE_LOOP_FEATURES = [
  { key: "planner", index: "01" },
  { key: "planConsultant", index: "02" },
  { key: "planReviewer", index: "03" },
  { key: "orchestrator", index: "04" },
  { key: "todoContinuation", index: "05" },
  { key: "categorySystem", index: "06" },
  { key: "backgroundAgents", index: "07" },
  { key: "wisdomAccumulation", index: "08" },
] as const

/** Loop diagram labels are not yet localized (see the lane report). */
const LOOP_STAGES = ["Human Intent", "Agent Execution", "Verified Result"] as const

export async function CoreLoopSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <ManifestoSection data-section="manifesto-core-loop" labelledBy="manifesto-core-loop-title">
      <h2 id="manifesto-core-loop-title" className={`${TITLE_CLASS} max-w-[68ch]`}>
        {t("coreLoop.title")}
      </h2>

      <ol
        aria-label={LOOP_STAGES.join(" / ")}
        className="border-line mt-12 flex flex-wrap items-center gap-x-4 gap-y-3 border-y py-5"
      >
        {LOOP_STAGES.map((stage, i) => (
          <li key={stage} className="flex items-center gap-4">
            <span
              className={
                i === LOOP_STAGES.length - 1
                  ? "border-accent-32 bg-accent-8 text-accent border px-3 py-1.5 font-mono text-xs tracking-[0.04em] uppercase"
                  : "border-line bg-ink-2 text-text-hi border px-3 py-1.5 font-mono text-xs tracking-[0.04em] uppercase"
              }
            >
              {stage}
            </span>
            {i < LOOP_STAGES.length - 1 ? (
              <ArrowRight aria-hidden="true" className="text-text-lo size-4 shrink-0" />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-12 [&>*:first-child]:border-t-0">
        {CORE_LOOP_FEATURES.map(({ key, index }) => (
          <LedgerRow key={key} index={index} title={t(`coreLoop.features.${key}.feature`)}>
            {t(`coreLoop.features.${key}.purpose`)}
          </LedgerRow>
        ))}
      </div>
    </ManifestoSection>
  )
}
