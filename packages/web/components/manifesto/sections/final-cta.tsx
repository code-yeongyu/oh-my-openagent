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
      className="from-primary/10 to-background bg-gradient-to-t px-6 py-32 text-center"
    >
      <div className="space-y-8">
        <h2 className="text-foreground text-6xl font-black tracking-tighter md:text-8xl">
          {t("finalCta.title")}
        </h2>

        <Button size="lg" className="rounded-full px-8 py-6 text-lg" asChild>
          <Link
            href="https://github.com/code-yeongyu/oh-my-openagent"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("finalCta.button")} <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
