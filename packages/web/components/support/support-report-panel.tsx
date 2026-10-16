"use client"

import type { JSX } from "react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import type { SupportReport } from "@/lib/support-report"

const COPIED_MS = 2000

export interface SupportReportPanelProps {
  readonly report: SupportReport
  readonly issueUrl: string
  readonly discordUrl: string
  readonly labels: {
    readonly reportHeading: string
    readonly titleLabel: string
    readonly bodyLabel: string
    readonly copy: string
    readonly copied: string
    readonly openIssue: string
    readonly openIssueNote: string
    readonly discord: string
    readonly privacy: string
  }
}

/** The prefilled report, as plain text the user can read and copy, and the two ways to send it. */
export function SupportReportPanel({
  report,
  issueUrl,
  discordUrl,
  labels,
}: SupportReportPanelProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const text = [report.title, report.body].filter((part) => part.length > 0).join("\n\n")
  const hasReport = text.length > 0

  function copy(): void {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch((error: unknown) => console.warn("Failed to copy the report", error))
  }

  return (
    <div className="mt-10 max-w-3xl space-y-8">
      {hasReport ? (
        <section
          aria-labelledby="support-report"
          className="border-line bg-ink-1 border p-6 lg:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="support-report" className="type-heading text-text-hi">
              {labels.reportHeading}
            </h2>
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? labels.copied : labels.copy}
            </Button>
          </div>
          {report.title ? (
            <div className="mt-5">
              <p className="text-text-lo font-mono text-xs uppercase">{labels.titleLabel}</p>
              <p data-testid="support-report-title" className="text-text-hi mt-1 break-words">
                {report.title}
              </p>
            </div>
          ) : null}
          {report.body ? (
            <div className="mt-5">
              <p className="text-text-lo font-mono text-xs uppercase">{labels.bodyLabel}</p>
              <pre
                data-testid="support-report-body"
                className="text-text-mid bg-ink-0 border-line mt-1 max-h-96 overflow-auto border p-4 font-mono text-sm break-words whitespace-pre-wrap"
              >
                {report.body}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button asChild>
          <a href={issueUrl} target="_blank" rel="noreferrer noopener">
            {labels.openIssue}
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={discordUrl} target="_blank" rel="noreferrer noopener">
            {labels.discord}
          </a>
        </Button>
      </div>
      <p className="text-text-lo max-w-2xl text-sm leading-[1.7]">{labels.openIssueNote}</p>
      <p className="text-text-lo max-w-2xl text-sm leading-[1.7]">{labels.privacy}</p>
    </div>
  )
}
