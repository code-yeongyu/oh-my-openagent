import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { LitText } from "@/components/landing/lit-text"
import { Reveal } from "@/components/landing/motion-wrappers"
import { Frame } from "@/components/ledger/frame"

export async function SecretSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing")

  return (
    <section
      data-section="secret"
      aria-labelledby="secret-lead"
      className="border-line border-t py-24 lg:py-40"
    >
      <Frame>
        <div className="mx-auto max-w-4xl">
          <h2 id="secret-lead" className="type-title text-text-hi prose-cjk">
            {t("secret.lead")}
          </h2>
          <LitText
            text={t("secret.body")}
            className="prose-cjk mt-10 text-2xl leading-[1.6] font-medium md:text-3xl"
          />
          <Reveal className="mt-16">
            <p className="type-title text-accent prose-cjk">{t("secret.reveal")}</p>
          </Reveal>
        </div>
      </Frame>
    </section>
  )
}
