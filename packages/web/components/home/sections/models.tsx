import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { SectionHead } from "@/components/home/section-head"
import { MODEL_PROFILES } from "@/components/landing/story-data"

/** The tuned profiles OmO ships, as one wrapping list of chips: a list you can read, not a marquee. */
export async function ModelsSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.models")

  return (
    <section className="section" id="models" data-section="models" aria-labelledby="models-title">
      <div className="wrap">
        <SectionHead
          id="models-title"
          num="03"
          eyebrow={t("eyebrow")}
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <ul className="chips rise" data-testid="model-marquee" aria-label={t("caption")}>
          {MODEL_PROFILES.map((profile) => (
            <li key={profile} className="chip">
              <span className="dot" aria-hidden="true" />
              {profile}
            </li>
          ))}
        </ul>
        <p className="caption rise">{t("caption")}</p>
      </div>
    </section>
  )
}
