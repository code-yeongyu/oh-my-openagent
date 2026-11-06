import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import type { FormattedStatsData } from "@/lib/stats"

const ROWS = [
  ["ultrawork", "#ultrawork", "Ultrawork"],
  ["massUlw", "#mass-ulw", "Mass ulw"],
  ["models", "#models", "Models"],
  ["kibitzer", "#kibitzer", "Kibitzer"],
  ["skills", "#skills", "Skills"],
  ["crafted", "#crafted", "Crafted"],
] as const

/** Live numbers in one quiet row, then herdr's numbered README index of the sections below. */
export async function IndexStrip({
  stats,
}: {
  readonly stats: FormattedStatsData
}): Promise<JSX.Element> {
  const t = await getTranslations("home")

  return (
    <div className="wrap index">
      <dl className="stats reveal" aria-label={t("stats.label")}>
        <div>
          <dt>{t("stats.stars")}</dt>
          <dd>{stats.stars}</dd>
        </div>
        <div>
          <dt>{t("stats.total")}</dt>
          <dd>{stats.totalDownloads}</dd>
        </div>
        <div>
          <dt>{t("stats.monthly")}</dt>
          <dd>{stats.monthlyDownloads}</dd>
        </div>
      </dl>
      <nav aria-label={t("index.label")} className="reveal">
        <ol>
          {ROWS.map(([key, href, name], i) => (
            <li key={key}>
              <a href={href}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <span className="t">{name}</span>
                <span className="d">{t(`index.${key}`)}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  )
}
