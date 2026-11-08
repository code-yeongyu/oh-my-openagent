import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon } from "@/components/home/icons"
import { InstallBlock } from "@/components/home/install-block"
import { Link } from "@/i18n/routing"

const LABEL_KEYS = [
  "label",
  "windows",
  "unix",
  "powershell",
  "cmd",
  "next",
  "onComputer",
  "copy",
  "copied",
  "copyAria",
  "copiedStatus",
] as const

/** The install command is the page's last word: two-tone headline, the command block, then the docs. */
export async function ClosingSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.closing")
  const i = await getTranslations("home.install")
  const labels = Object.fromEntries(LABEL_KEYS.map((key) => [key, i(key)])) as Record<
    (typeof LABEL_KEYS)[number],
    string
  >

  return (
    <section data-section="install" className="closing" aria-labelledby="closing-title">
      <div className="wrap closing__inner">
        <h2 id="closing-title" className="h2 rise">
          {t("title")} <span className="soft">{t("soft")}</span>
        </h2>
        <p className="section__lede rise">{t("body")}</p>
        <div className="rise closing__install">
          <InstallBlock labels={labels} />
        </div>
        <div className="cta-row rise">
          <Link className="btn btn--primary" href="/docs">
            {t("docs")}
          </Link>
          <Link className="btn btn--ghost" href="/manifesto">
            {t("manifesto")} <Icon name="arrow" className="arrow" />
          </Link>
        </div>
      </div>
    </section>
  )
}
