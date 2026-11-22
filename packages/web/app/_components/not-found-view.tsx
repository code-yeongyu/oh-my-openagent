import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import type { Locale } from "@/i18n/config"

/** The 404 body every not-found boundary renders, in the route's locale. */
export async function NotFoundView({ locale }: { readonly locale: Locale }): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: "notFound" })
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-24 sm:px-5">
      <p className="eyebrow">404</p>
      <h1 className="text-text-hi text-3xl font-medium tracking-[-0.02em]">{t("title")}</h1>
      <p className="text-text-mid">{t("body")}</p>
      <a
        href={locale === "en" ? "/" : `/${locale}`}
        className="text-accent underline-grow focus-ring w-fit"
      >
        {t("home")}
      </a>
    </section>
  )
}
