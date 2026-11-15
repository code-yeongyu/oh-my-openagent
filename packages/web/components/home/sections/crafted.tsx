import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { SectionHead } from "@/components/home/section-head"
import { Link } from "@/i18n/routing"

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** Eight things that run under every session, as a numbered two-column list. */
export async function CraftedSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.crafted")

  return (
    <section
      className="section"
      id="crafted"
      data-section="crafted"
      aria-labelledby="crafted-title"
    >
      <div className="wrap">
        <SectionHead
          id="crafted-title"
          num="06"
          eyebrow={t("eyebrow")}
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <ol className="facts rise">
          {ITEMS.map((i) => (
            <li key={i}>
              <span className="n">{String(i).padStart(2, "0")}</span>
              <div>
                <strong>{t(`item${i}Name`)}</strong>
                <p>{t(`item${i}Desc`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="caption rise">
          <Link href="/docs">{t("docs")}</Link>
        </p>
      </div>
    </section>
  )
}
