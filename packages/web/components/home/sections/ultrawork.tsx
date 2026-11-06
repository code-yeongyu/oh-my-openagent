import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { SectionHead } from "@/components/home/section-head"

/** The keyword in a prompt line, and the three things the agent then does on its own, arriving one after another. */
export async function UltraworkSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.ultrawork")
  const steps = [t("step1"), t("step2"), t("step3")]

  return (
    <section
      className="section"
      id="ultrawork"
      data-section="ultrawork"
      aria-labelledby="ultrawork-title"
    >
      <div className="wrap split">
        <SectionHead
          id="ultrawork-title"
          num="01"
          eyebrow={t("eyebrow")}
          dot="accent"
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <figure className="win rise">
          <div className="frame__bar">
            <span className="frame__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="frame__title">{t("frame")}</span>
            <span />
          </div>
          <div className="term">
            <p className="oline">
              <span className="p">›</span> {t("prompt")} <mark className="kw">{t("keyword")}</mark>
            </p>
            <ol className="steps">
              {steps.map((step, i) => (
                <li
                  key={step}
                  className="rise"
                  style={{ ["--delay" as string]: `${300 + i * 260}ms` }}
                >
                  <Icon name="check" className="steps__mark" />
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </figure>
      </div>
    </section>
  )
}
