import type { Metadata } from "next"
import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { DocsShell } from "@/components/docs/docs-shell"
import { wrapTables } from "@/components/docs/wrap-tables"
import { InstallTabs } from "@/components/landing/install-tabs"
import { splitDocPage } from "@/lib/docs-page"
import { loadDocSource } from "@/lib/docs-source"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "docs.install" })
  return { title: t("title"), description: t("description") }
}

export default async function InstallDocsPage(): Promise<JSX.Element> {
  const t = await getTranslations("docs")
  const page = splitDocPage(wrapTables(loadDocSource("guide/install.md")))

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={page.sections.map(({ id, title }) => ({ id, title }))}
    >
      <article className="docs-content" dangerouslySetInnerHTML={{ __html: page.lead }} />
      <InstallTabs className="mt-6" />
      <article
        className="docs-content mt-6"
        dangerouslySetInnerHTML={{ __html: page.afterWidget }}
      />
      {page.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-20 lg:scroll-mt-12">
          <article className="docs-content" dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </DocsShell>
  )
}
