import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { LitProgress, LitWords } from "@/components/landing/lit-text"
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
          <LitProgress>
            <LitWords
              text={t("secret.body")}
              className="prose-cjk mt-10 text-2xl leading-[1.6] font-medium md:text-3xl"
            />
            <p
              data-testid="secret-follow"
              className="lit-follow type-title text-accent prose-cjk mt-16"
            >
              {t("secret.reveal")}
            </p>
          </LitProgress>
        </div>
      </Frame>
    </section>
  )
}
