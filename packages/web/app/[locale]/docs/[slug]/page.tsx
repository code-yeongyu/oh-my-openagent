import type { Metadata } from "next"
import type { JSX } from "react"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { DocsShell } from "@/components/docs/docs-shell"
import { wrapTables } from "@/components/docs/wrap-tables"
import { splitDocSections } from "@/lib/docs-page"
import { DOC_GUIDE_PAGES, type DocGuidePage } from "@/lib/docs-sections"
import { loadDocSource } from "@/lib/docs-source"

type Params = Promise<{ locale: string; slug: string }>

// No `dynamicParams = false`: on Cloudflare the Worker's incremental cache starts empty, and a
// closed route answers every cache miss with a 404 instead of rendering. Unknown slugs still 404
// through notFound() below.
export function generateStaticParams(): Array<{ readonly slug: string }> {
  return DOC_GUIDE_PAGES.map(({ slug }) => ({ slug }))
}

function findGuidePage(slug: string): DocGuidePage | undefined {
  return DOC_GUIDE_PAGES.find((page) => page.slug === slug)
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = findGuidePage((await params).slug)
  return page ? { title: page.title, description: page.description } : {}
}

export default async function GuideDocsPage({ params }: { params: Params }): Promise<JSX.Element> {
  const guide = findGuidePage((await params).slug)
  if (!guide) notFound()

  const t = await getTranslations("docs")
  const page = splitDocSections(wrapTables(loadDocSource(guide.file)))

  return (
    <DocsShell
      mobileHeader={t("mobileHeader")}
      searchPlaceholder={t("searchPlaceholder")}
      sections={page.sections.map(({ id, title }) => ({ id, title }))}
    >
      <article className="docs-content" dangerouslySetInnerHTML={{ __html: page.lead }} />
      {page.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-20 lg:scroll-mt-12">
          <article className="docs-content" dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </DocsShell>
  )
}
