import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { SectionHead } from "@/components/home/section-head"

/** Two loops side by side: the small model watching and reading memory, the main agent taking its nudge. */
export async function KibitzerSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.kibitzer")

  return (
    <section
      className="section"
      id="kibitzer"
      data-section="kibitzer"
      aria-labelledby="kibitzer-title"
    >
      <div className="wrap">
        <SectionHead
          id="kibitzer-title"
          num="04"
          eyebrow={t("eyebrow")}
          dot="busy"
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <figure className="win kib rise" aria-label={t("figure")}>
          <div className="kib__pane">
            <p className="kib__who">{t("sidecar")}</p>
            <p className="kib__loop">{t("cheapLoop")}</p>
            <ol className="kib__steps">
              <li>{t("watch")}</li>
              <li>{t("read")}</li>
              <li>{t("judge")}</li>
            </ol>
            <div className="kib__memory">
              <p className="kib__tag">{t("memory")}</p>
              <p>{t("memoryNote")}</p>
            </div>
          </div>
          <div className="kib__pane">
            <p className="kib__who">{t("main")}</p>
            <p className="kib__loop">{t("expensiveLoop")}</p>
            <ol className="kib__steps">
              <li>{t("plan")}</li>
              <li>{t("act")}</li>
              <li className="kib__nudge rise" style={{ ["--delay" as string]: "400ms" }}>
                <span className="kib__tag">{t("nudge")}</span>
                {t("reason")}
              </li>
              <li className="kib__now">{t("testFirst")}</li>
              <li>{t("ship")}</li>
            </ol>
          </div>
        </figure>
      </div>
    </section>
  )
}
