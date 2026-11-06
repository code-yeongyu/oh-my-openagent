import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

const QUOTES = [1, 2, 3] as const

/** The three published user quotes, unchanged from the current page. */
export async function VoicesSection(): Promise<JSX.Element> {
  const t = await getTranslations("home.voices")

  return (
    <section data-section="voices" className="section" aria-labelledby="voices-title">
      <div className="wrap">
        <h2 id="voices-title" className="h2 h2--sm rise">
          {t("title")}
        </h2>
        <div className="grid-3">
          {QUOTES.map((i) => (
            <figure key={i} className="quote rise" style={{ ["--delay" as string]: `${i * 80}ms` }}>
              <blockquote>{t(`q${i}`)}</blockquote>
              <figcaption>{t(`a${i}`)}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
