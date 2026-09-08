import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

export async function FinalCtaSection(): Promise<JSX.Element> {
  const t = await getTranslations("manifesto")

  return (
    <section
      data-section="manifesto-final-cta"
      aria-labelledby="manifesto-final-cta-title"
      className="hairline-x py-24 lg:py-40"
    >
      <div className="flex flex-col items-start gap-10">
        <h2
          id="manifesto-final-cta-title"
          className="text-text-hi font-mono text-[clamp(2.5rem,1.35rem+4.4vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.03em]"
        >
          {t("finalCta.title")}
        </h2>

        <Button size="lg" asChild>
          <Link
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("finalCta.button")} <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
