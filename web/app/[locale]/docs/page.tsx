import { getTranslations } from "next-intl/server"
import { MDXRemote } from "next-mdx-remote/rsc"
import { DocsShell } from "@/components/docs/docs-shell"
import { mdxComponents } from "@/components/docs/mdx-components"
import { DOC_SECTIONS } from "@/lib/docs-sections"
import { loadDocSource } from "@/lib/docs-source"

export default async function DocsPage() {
  const t = await getTranslations("docs")

  const sectionsWithSource = await Promise.all(
    DOC_SECTIONS.map(async (section) => ({
      ...section,
      source: await loadDocSource(section.file),
    })),
  )

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={DOC_SECTIONS.map((s) => ({ id: s.id, title: s.title }))}
    >
      {sectionsWithSource.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <MDXRemote source={section.source} components={mdxComponents} />
        </section>
      ))}
    </DocsShell>
  )
}
