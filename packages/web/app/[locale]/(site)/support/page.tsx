import type { Metadata } from "next"
import type { JSX } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"
import { SupportReportPanel } from "@/components/support/support-report-panel"
import { githubIssueUrl, readSupportQuery } from "@/lib/support-report"

const DISCORD_URL = "https://discord.gg/PUwSMR9XNk"

// The report arrives in the query, so the page is rendered per request, like the download page.
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "support.metadata" })
  return { title: t("title"), description: t("description"), robots: { index: false } }
}

/**
 * Where the desktop app's "Report a problem" lands (`?title=&body=`). The report is shown as text
 * only and handed on to a prefilled GitHub issue. The page itself saves nothing, but the query (the report)
 * reaches this server and its edge like any URL, so the privacy note says exactly that.
 */
export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ title?: string | string[]; body?: string | string[] }>
}): Promise<JSX.Element> {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  setRequestLocale(locale)
  const t = await getTranslations("support")
  const report = readSupportQuery(query)
  const hasReport = report.title.length > 0 || report.body.length > 0

  return (
    <Frame as="section" aria-labelledby="support-title" innerClassName="py-16 lg:py-24">
      <Eyebrow rule>{t("eyebrow")}</Eyebrow>
      <h1 id="support-title" className="type-title text-text-hi mt-5 max-w-3xl">
        {t("title")}
      </h1>
      <p className="text-text-mid prose-cjk mt-5 max-w-2xl text-lg leading-[1.7]">
        {hasReport ? t("leadWithReport") : t("lead")}
      </p>
      <SupportReportPanel
        report={report}
        issueUrl={githubIssueUrl(report)}
        discordUrl={DISCORD_URL}
        labels={{
          reportHeading: t("report.heading"),
          titleLabel: t("report.titleLabel"),
          bodyLabel: t("report.bodyLabel"),
          copy: t("report.copy"),
          copied: t("report.copied"),
          openIssue: t("actions.openIssue"),
          openIssueNote: t("actions.openIssueNote"),
          discord: t("actions.discord"),
          privacy: t("privacy"),
        }}
      />
    </Frame>
  )
}
