import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { LiveNumbers } from "@/components/home/live-numbers"
import type { FormattedStatsData } from "@/lib/stats"

const ROWS = [
  ["ultrawork", "#ultrawork", "nav.ultrawork"],
  ["massUlw", "#mass-ulw", "nav.massUlw"],
  ["models", "#models", "nav.models"],
  ["kibitzer", "#kibitzer", "kibitzer.eyebrow"],
  ["skills", "#skills", "nav.skills"],
  ["crafted", "#crafted", "crafted.eyebrow"],
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
      <LiveNumbers
        stats={stats}
        labels={{
          label: t("stats.label"),
          stars: t("stats.stars"),
          total: t("stats.total"),
          monthly: t("stats.monthly"),
        }}
      />
      <nav aria-label={t("index.label")} className="rise">
        <ol>
          {ROWS.map(([key, href, name], i) => (
            <li key={key}>
              <a href={href}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <span className="t">{t(name)}</span>
                <span className="d">{t(`index.${key}`)}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  )
}
