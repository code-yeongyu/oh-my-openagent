import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { MassUlwGraph } from "@/components/landing/dag/mass-ulw-graph"
import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"

/** `sticky-aside` (DESIGN.md §0 StyleGallery): sticky title column beside the desktop-app DAG view. */
export async function MassUlwSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="mass-ulw"
      aria-labelledby="mass-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <SectionHeader
              id="mass-title"
              eyebrow="mass ulw"
              dot="busy"
              title={t("ulw.title")}
              intro={t("ulw.body")}
            />
          </Reveal>
          <Reveal index={1}>
            <MassUlwGraph
              variant="app"
              testId="mass-ulw-graph"
              regionLabel={t("dag.region")}
              frame={{
                windowTitle: t("dag.windowTitle"),
                threads: t("dag.threads"),
                threadRows: [t("dag.thread1"), t("dag.thread2"), t("dag.thread3")],
                workflow: t("dag.workflow"),
                runStatus: {
                  pending: t("dag.status.pending"),
                  running: t("dag.status.running"),
                  completed: t("dag.status.completed"),
                },
                assistantPlanning: t("dag.assistantPlanning"),
                assistantRunning: t("dag.assistantRunning"),
                assistantDone: t("dag.assistantDone"),
              }}
              graph={{
                wave: t("dag.wave"),
                done: t("dag.done"),
                running: t("dag.running"),
                fit: t("dag.fit"),
                center: t("dag.center"),
              }}
            />
          </Reveal>
        </div>
      </Frame>
    </section>
  )
}
