import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { InstallCommand } from "@/components/landing/install-command"
import { Reveal } from "@/components/landing/motion-wrappers"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"

/** Full-bleed `--ink-1` band: Title + CommandBar + primary/secondary actions. */
export async function CtaSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section data-section="cta" aria-labelledby="cta-title" className="mt-[var(--space-40)]">
      <div className="border-line bg-ink-1 border-t border-b">
        <Frame>
          <Reveal className="flex flex-col items-start gap-8 py-16 lg:py-24">
            <Eyebrow rule dot="accent">
              {t("cta.eyebrow")}
            </Eyebrow>
            <h2 id="cta-title" className="type-title text-text-hi max-w-3xl">
              {t("cta.title")}
            </h2>
            <p className="text-text-mid max-w-xl text-lg leading-[1.6]">{t("cta.subtitle")}</p>
            <InstallCommand command={t("cta.installCommand")} className="max-w-xl" />
            <div className="flex flex-wrap items-center gap-6">
              <Button size="lg" asChild>
                <Link href="/docs#installation">{t("cta.installNow")}</Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link href="/docs">{t("cta.readTheDocs")}</Link>
              </Button>
            </div>
          </Reveal>
        </Frame>
      </div>
    </section>
  )
}
