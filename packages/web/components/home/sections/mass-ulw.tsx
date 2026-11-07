import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { DagPanel } from "@/components/home/dag-panel"
import { SectionHead } from "@/components/home/section-head"

/** The current omo.dev layout: a sticky title column beside the desktop app window with the workflow graph open. */
export async function MassUlwSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.massUlw")

  return (
    <section
      className="section"
      id="mass-ulw"
      data-section="mass-ulw"
      aria-labelledby="mass-ulw-title"
    >
      <div className="wrap aside">
        <div className="aside__head">
          <SectionHead
            id="mass-ulw-title"
            num="02"
            eyebrow={t("eyebrow")}
            dot="busy"
            title={t("title")}
            soft={t("soft")}
          >
            {t("body")}
          </SectionHead>
        </div>
        <div className="rise aside__body">
          <DagPanel variant="app" testId="mass-ulw-graph" />
        </div>
      </div>
    </section>
  )
}
