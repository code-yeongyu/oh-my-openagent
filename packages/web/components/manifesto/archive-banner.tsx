import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"

import { Eyebrow } from "@/components/ledger/eyebrow"
import { Link } from "@/i18n/routing"
import { PROSE_LIMIT } from "@/components/manifesto/manifesto-section"

/**
 * Sits above the archived January 2026 manifesto: the version date, one line on what the
 * text argued back then, and the way back to the current version. Same ruled `ink-1`
 * panel as the legacy token-cost aside (DESIGN.md §4: ruled panels, no floating cards).
 */
export async function ArchiveBanner(): Promise<JSX.Element> {
  const t = await getTranslations("manifestoLegacy")

  return (
    <section data-section="manifesto-archive" aria-labelledby="manifesto-archive-eyebrow">
      <div className={`${PROSE_LIMIT} border-line bg-ink-1 mt-16 space-y-4 border p-6 lg:mt-24`}>
        <Eyebrow rule as="p" id="manifesto-archive-eyebrow">
          {t("archive.eyebrow")}
        </Eyebrow>
        <p className="text-text-mid prose-cjk leading-[1.6]">{t("archive.note")}</p>
        <Link
          href="/manifesto"
          className="text-accent underline-grow focus-visible:outline-accent-32 inline-flex items-center gap-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("archive.back")} <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  )
}
