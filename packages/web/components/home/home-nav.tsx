import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { ThemeSwitch } from "@/components/home/theme-switch"
import { Link } from "@/i18n/routing"
import { GITHUB_URL } from "@/components/home/links"
import type { ReactNode } from "react"

/** A same-page anchor on the home page; a locale-aware link from every other page. */
function NavLink({
  onHome,
  hash,
  path,
  className,
  children,
}: {
  readonly onHome: boolean
  readonly hash: string
  readonly path: string
  readonly className?: string
  readonly children: ReactNode
}): JSX.Element {
  return onHome ? (
    <a className={className} href={hash}>
      {children}
    </a>
  ) : (
    <Link className={className} href={path}>
      {children}
    </Link>
  )
}

const SECTIONS = ["ultrawork", "massUlw", "models", "skills"] as const
const ANCHORS: Readonly<Record<(typeof SECTIONS)[number], string>> = {
  ultrawork: "#ultrawork",
  massUlw: "#mass-ulw",
  models: "#models",
  skills: "#skills",
}

/** A floating pill bar: the mark, the section links, the theme switch, GitHub stars and the one solid button. */
export async function HomeNav({
  stars,
  onHome = true,
}: {
  readonly stars: string
  /** On the home page the links jump to sections; elsewhere they go back to them on the home page. */
  readonly onHome?: boolean
}): Promise<JSX.Element> {
  const t = await getTranslations("home.nav")

  return (
    <header className="nav">
      <div className="nav__inner">
        <NavLink className="brand" onHome={onHome} hash="#top" path="/">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 28 px static SVG mark; next/image adds nothing */}
          <img src="/brand/omo-mark.svg" alt="" width={28} height={28} />
          OmO
        </NavLink>
        <nav aria-label={t("primary")}>
          <ul className="nav__links">
            {SECTIONS.map((key) => (
              <li key={key}>
                <NavLink onHome={onHome} hash={ANCHORS[key]} path={`/${ANCHORS[key]}`}>
                  {t(key)}
                </NavLink>
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
          <NavLink
            className="btn btn--primary btn--sm"
            onHome={onHome}
            hash="#install"
            path="/docs/install"
          >
            {t("install")}
          </NavLink>
        </div>
      </div>
    </header>
  )
}
