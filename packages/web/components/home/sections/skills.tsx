import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { SectionHead } from "@/components/home/section-head"
import { SHIPPED_SKILLS } from "@/components/home/skills-data"
import { Link } from "@/i18n/routing"

export async function SkillsSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.skills")

  return (
    <section className="section" id="skills" data-section="skills" aria-labelledby="skills-title">
      <div className="wrap">
        <SectionHead
          id="skills-title"
          num="05"
          eyebrow={t("eyebrow")}
          title={t("title")}
          soft={t("soft")}
        >
          {t("body")}
        </SectionHead>
        <ul className="rows rows--two rise">
          {SHIPPED_SKILLS.map((skill) => (
            <li key={skill.name}>
              <code>{skill.name}</code>
              <span>{skill.blurb}</span>
            </li>
          ))}
        </ul>
        <p className="caption rise">
          <Link href="/docs">{t("more")}</Link>
        </p>
      </div>
    </section>
  )
}
