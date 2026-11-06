import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { DISCORD_URL, GITHUB_URL, LEGAL_BASE, RELEASES_URL, X_URL } from "@/components/home/links"
import { localeNames, locales, type Locale } from "@/i18n/config"
import { Link } from "@/i18n/routing"

const EXTERNAL = [
  ["releases", RELEASES_URL],
  ["github", GITHUB_URL],
  ["discord", DISCORD_URL],
  ["x", X_URL],
  ["privacy", `${LEGAL_BASE}/privacy-policy.md`],
  ["terms", `${LEGAL_BASE}/terms-of-service.md`],
] as const

/** doriterm's footer: the wordmark and one row of links, then the languages and the licence line. */
export async function HomeFooter({ locale }: { readonly locale: Locale }): Promise<JSX.Element> {
  const t = await getTranslations("home.footer")
  const year = new Date().getUTCFullYear().toString()

  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <a className="brand" href="#top">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG mark */}
          <img src="/brand/omo-mark.svg" alt="" width={24} height={24} />
          OmO
        </a>
        <nav aria-label="Footer">
          <Link href="/docs">{t("docs")}</Link>
          <Link href="/manifesto">{t("manifesto")}</Link>
          {EXTERNAL.map(([key, href]) => (
            <a key={key} href={href} rel="noopener noreferrer">
              {t(key)}
            </a>
          ))}
        </nav>
      </div>
      <div className="wrap footer__meta">
        <p>{t("copyright", { year })}</p>
        <nav aria-label={t("language")} className="footer__langs">
          {locales.map((code) => (
            <Link
              key={code}
              href="/"
              locale={code}
              aria-current={code === locale ? "true" : undefined}
              lang={code}
            >
              {localeNames[code]}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
