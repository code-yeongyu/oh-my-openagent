import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { DORI_URL, DORITERM_URL } from "@/components/home/links"

/** The sibling products, mirrored from doriterm's makers section. */
export async function MakersSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.makers")

  return (
    <section className="section" id="makers" data-section="makers" aria-labelledby="makers-title">
      <div className="wrap">
        <h2 id="makers-title" className="h2 rise">
          {t("title")} <span className="soft">{t("soft")}</span>
        </h2>
        <div className="makers__grid">
          <a className="maker rise" href={DORI_URL}>
            <span className="maker__name">Dori</span>
            <span className="maker__what">{t("dori")}</span>
            <span className="maker__url">sisyphuslabs.ai →</span>
          </a>
          <a className="maker rise" href={DORITERM_URL} style={{ ["--delay" as string]: "80ms" }}>
            <span className="maker__name">doriterm</span>
            <span className="maker__what">{t("doriterm")}</span>
            <span className="maker__url">doriterm.com →</span>
          </a>
        </div>
      </div>
    </section>
  )
}
