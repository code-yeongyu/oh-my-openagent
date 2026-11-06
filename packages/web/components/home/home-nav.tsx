import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { ThemeSwitch } from "@/components/home/theme-switch"
import { Link } from "@/i18n/routing"
import { GITHUB_URL } from "@/components/home/links"

const SECTIONS = ["ultrawork", "massUlw", "models", "skills"] as const
const ANCHORS: Readonly<Record<(typeof SECTIONS)[number], string>> = {
  ultrawork: "#ultrawork",
  massUlw: "#mass-ulw",
  models: "#models",
  skills: "#skills",
}

/** A floating pill bar: the mark, the section links, the theme switch, GitHub stars and the one solid button. */
export async function HomeNav({ stars }: { readonly stars: string }): Promise<JSX.Element> {
  const t = await getTranslations("home.nav")

  return (
    <header className="nav">
      <div className="nav__inner">
        <a className="brand" href="#top">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 28 px static SVG mark; next/image adds nothing */}
          <img src="/brand/omo-mark.svg" alt="" width={28} height={28} />
          OmO
        </a>
        <nav aria-label={t("primary")}>
          <ul className="nav__links">
            {SECTIONS.map((key) => (
              <li key={key}>
                <a href={ANCHORS[key]}>{t(key)}</a>
              </li>
            ))}
            <li>
              <Link href="/docs">{t("docs")}</Link>
            </li>
          </ul>
        </nav>
        <div className="nav__end">
          <ThemeSwitch
            label={t("theme")}
            labels={{ system: t("system"), light: t("light"), dark: t("dark") }}
          />
          <a
            className="btn btn--ghost btn--sm nav__stars"
            href={GITHUB_URL}
            aria-label={t("stars", { count: stars })}
          >
            <Icon name="github" className="btn__icon" />
            <span className="tabular">{stars}</span>
          </a>
          <a className="btn btn--primary btn--sm" href="#install">
            {t("install")}
          </a>
        </div>
      </div>
    </header>
  )
}
