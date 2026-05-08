import { getTranslations } from "next-intl/server"
import { DocsShell } from "@/components/docs/docs-shell"
import { DOC_SECTIONS } from "@/lib/docs-sections"
import { loadDocSource } from "@/lib/docs-source"

export default async function DocsPage() {
  const t = await getTranslations("docs")

  const sectionsWithHtml = DOC_SECTIONS.map((section) => ({
    ...section,
    html: loadDocSource(section.file),
  }))

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={DOC_SECTIONS.map((s) => ({ id: s.id, title: s.title }))}
    >
      {sectionsWithHtml.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <article className="docs-content" dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </DocsShell>
  )
}
