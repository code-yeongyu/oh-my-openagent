import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { PROSE_LIMIT } from "@/components/manifesto/manifesto-section"
import { ReadingParagraph } from "@/components/manifesto/reading/paragraph"

export const LEGACY_MANIFESTO_PATH = "/manifesto/2026-01"

export async function ManifestoClosing(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <section
      data-section="manifesto-closing"
      aria-labelledby="manifesto-closing-title"
      className="hairline-x py-24 lg:py-40"
    >
      <div className="flex flex-col items-start gap-10">
        <div className={PROSE_LIMIT}>
          <ReadingParagraph text={t("closing.lead")} />
        </div>

        <h2
          id="manifesto-closing-title"
          className="type-display text-text-hi font-mono tracking-[-0.03em]"
        >
          {t("closing.title")}
        </h2>

        <Button size="lg" asChild>
          <Link
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("closing.button")} <ArrowRight aria-hidden="true" />
          </Link>
        </Button>

        <p
          data-testid="manifesto-legacy-note"
          className={`${PROSE_LIMIT} text-text-lo prose-cjk border-line mt-6 border-t pt-6 text-sm leading-[1.6]`}
        >
          {t.rich("legacyNote", {
            date: (chunks) => <time dateTime="2026-01-19">{chunks}</time>,
            link: (chunks) => (
              <Link
                href={LEGACY_MANIFESTO_PATH}
                className="text-accent underline-grow focus-visible:outline-accent-32 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </section>
  )
}
