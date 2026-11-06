import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { DORI_URL, DORITERM_URL } from "@/components/home/links"
import { OmoWindow } from "@/components/home/omo-window"
import { Link } from "@/i18n/routing"
import { desktopDownloadEnabled, PUBLIC_DESKTOP_BETA_URL } from "@/lib/desktop-download"

const WINDOW_KEYS = [
  "label",
  "title",
  "meta",
  "workflow",
  "progress",
  "wave",
  "pending",
  "running",
  "completed",
  "blocked",
  "footChecked",
  "footBlocked",
  "footSource",
] as const

/**
 * doriterm.com's live hero: centred two-tone headline over a static dot field, one solid button, one solid button, the makers line, then OmO itself running in a
 * terminal window. The headline is the LCP element, so the hero has no scroll reveal.
 */
export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.hero")
  const w = await getTranslations("home.window")
  const labels = Object.fromEntries(
    WINDOW_KEYS.map((key) => [key, w.raw(key) as string]),
  ) as Record<(typeof WINDOW_KEYS)[number], string>

  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero__bg" aria-hidden="true" />
      <div className="wrap hero__inner">
        <h1 id="hero-title" className="display">
          {t("title")}
          <br />
          <span className="display__accent">{t("accent")}</span>
        </h1>
        <p className="hero__sub">{t("sub")}</p>
        <div className="cta-row">
          <Link className="btn btn--primary" href="/docs/install">
            {t("start")}
          </Link>
          {desktopDownloadEnabled() ? (
            <Link className="btn btn--ghost" href="/download">
              {t("download")} <Icon name="arrow" className="arrow" />
            </Link>
          ) : (
            <a className="btn btn--ghost" href={PUBLIC_DESKTOP_BETA_URL}>
              {t("beta")} <Icon name="arrow" className="arrow" />
            </a>
          )}
        </div>
        <p className="hero__makers">
          {t.rich("makers", {
            team: (chunks) => <a href="#makers">{chunks}</a>,
            dori: (chunks) => <a href={DORI_URL}>{chunks}</a>,
            term: (chunks) => <a href={DORITERM_URL}>{chunks}</a>,
          })}
        </p>
        <OmoWindow labels={labels} />
      </div>
    </section>
  )
}
