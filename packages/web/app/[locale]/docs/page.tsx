import { getTranslations } from "next-intl/server"
import { DocsShell } from "@/components/docs/docs-shell"
import { wrapTables } from "@/components/docs/wrap-tables"
import { DOC_SECTIONS } from "@/lib/docs-sections"
import { loadDocSource } from "@/lib/docs-source"

export default async function DocsPage() {
  const t = await getTranslations("docs")

  const sectionsWithHtml = DOC_SECTIONS.map((section) => ({
    ...section,
    html: wrapTables(loadDocSource(section.file)),
  }))

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={DOC_SECTIONS.map((s) => ({ id: s.id, title: s.title }))}
    >
      {sectionsWithHtml.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="border-line scroll-mt-20 border-b pt-16 pb-16 first:pt-0 last:border-b-0 last:pb-0 lg:scroll-mt-12"
        >
          <article className="docs-content" dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </DocsShell>
  )
}
