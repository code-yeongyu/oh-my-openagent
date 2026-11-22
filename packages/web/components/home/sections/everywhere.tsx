import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Icon, type IconName } from "@/components/home/icons"
import { SectionHead } from "@/components/home/section-head"
import { PLATFORMS } from "@/components/landing/story-data"

const CARDS: ReadonlyArray<readonly [string, IconName]> = [
  ["terminal", "terminal"],
  ["desktop", "window"],
  ["chat", "chat"],
]

/** Where OmO runs today, and the chat apps being wired in; the chat card says plainly that it is coming. */
export async function EverywhereSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.everywhere")

  return (
    <section
      className="section"
      id="everywhere"
      data-section="everywhere"
      aria-labelledby="everywhere-title"
    >
      <div className="wrap">
        <SectionHead
          id="everywhere-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          soft={t("soft")}
        />
        <div className="grid-3">
          {CARDS.map(([key, icon], i) => (
            <article
              key={key}
              className="card rise"
              style={{ ["--delay" as string]: `${i * 80}ms` }}
            >
              <span className="card__icon" aria-hidden="true">
                <Icon name={icon} />
              </span>
              <h3>{t(`${key}Title`)}</h3>
              <p>{t(`${key}Body`)}</p>
              {key === "chat" ? (
                <ul className="mini-chips" data-testid="platform-list">
                  {PLATFORMS.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <p className="meta">{t(`${key}Meta`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
