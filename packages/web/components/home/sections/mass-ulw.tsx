import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { RunGraph } from "@/components/home/graph/run-graph"
import { SectionHead } from "@/components/home/section-head"

/** Escapes copy before the one <b> tag the captions use is put back, so a translation cannot inject markup. */
const caption = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?)b&gt;/g, "<$1strong>")

export async function MassUlwSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.massUlw")

  return (
    <section className="section" id="mass-ulw" aria-labelledby="mass-ulw-title">
      <div className="wrap">
        <SectionHead
          id="mass-ulw-title"
          num="02"
          eyebrow={t("eyebrow")}
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <RunGraph
          steps={[t("step1"), t("step2"), t("step3"), t("step4")]}
          captions={[1, 2, 3, 4].map((i) => caption(t.raw(`cap${i}`) as string))}
          hubLabel={t("hub")}
          figureLabel={t("figure")}
          stepsLabel={t("steps")}
        />
      </div>
    </section>
  )
}
