import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { DORI_URL, DORITERM_URL } from "@/components/home/links"
import { DagPanel } from "@/components/home/dag-panel"
import { Link } from "@/i18n/routing"
import { desktopDownloadEnabled, PUBLIC_DESKTOP_BETA_URL } from "@/lib/desktop-download"

/**
 * doriterm.com's live hero: centred two-tone headline over a static dot field, one solid button, the makers line,
 * then the workflow graph panel of the current omo.dev hero.
 * The headline is the LCP element, so the hero has no scroll reveal.
 */
export async function HeroSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.hero")

  return (
    <section className="hero" id="top" data-section="hero" aria-labelledby="hero-title">
      <div className="hero__bg" aria-hidden="true" />
      <div className="wrap hero__inner">
        <h1 id="hero-title" className="display">
          {t("title")}
          <br />
          <span className="display__accent">{t("accent")}</span>
        </h1>
        <p className="hero__sub" data-testid="hero-tagline">
          {t("sub")}
        </p>
        <div className="cta-row">
          <Link className="btn btn--primary" href="/docs/install">
            {t("start")}
          </Link>
          {desktopDownloadEnabled() ? (
            <Link className="btn btn--ghost" href="/download" data-testid="hero-desktop-cta">
              {t("download")} <Icon name="arrow" className="arrow" />
            </Link>
          ) : (
            <a
              className="btn btn--ghost"
              href={PUBLIC_DESKTOP_BETA_URL}
              data-testid="hero-desktop-beta-cta"
            >
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
        <div className="hero__graph">
          <DagPanel variant="panel" testId="hero-dag" />
        </div>
      </div>
    </section>
  )
}
