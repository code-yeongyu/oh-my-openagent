import type { Metadata } from "next"
import type { JSX } from "react"
import { getTranslations } from "next-intl/server"
import { DocumentShell } from "@/app/_components/document-shell"
import { NotFoundView } from "@/app/_components/not-found-view"
import { siteViewport } from "@/app/_components/site-metadata"
import { defaultLocale, languageTag } from "@/i18n/config"

export const metadata: Metadata = { title: "404 | OmO", robots: { index: false } }
export const viewport = siteViewport

/** Unmatched URLs bypass every layout (the root layouts sit under dynamic or route segments). */
export default async function GlobalNotFound(): Promise<JSX.Element> {
  const t = await getTranslations({ locale: defaultLocale, namespace: "nav" })
  return (
    <DocumentShell lang={languageTag(defaultLocale)}>
      <a href="#main-content" className="skip-link focus-ring">
        {t("skipToContent")}
      </a>
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        <NotFoundView locale={defaultLocale} />
      </main>
    </DocumentShell>
  )
}
