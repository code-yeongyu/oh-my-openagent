import type { JSX } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  formatInstallerSize,
  platformKey,
  type DesktopRelease,
  type DesktopVisitor,
  type InstallerChoice,
} from "@/lib/desktop-download"

export interface PrimaryDownloadProps {
  readonly release: DesktopRelease
  readonly visitor: DesktopVisitor | null
  readonly choice: InstallerChoice | null
}

function Panel({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div className="border-line bg-ink-1 min-h-44 border p-6 lg:p-8" aria-live="polite">
      {children}
    </div>
  )
}

export function PrimaryDownload({ release, visitor, choice }: PrimaryDownloadProps): JSX.Element {
  const t = useTranslations("download")
  const locale = useLocale()
  const format = useFormatter()

  if (visitor === null || choice === null) {
    return (
      <Panel>
        <p className="text-text-lo" role="status">
          {t("detecting")}
        </p>
      </Panel>
    )
  }
  if (visitor.device === "phone") {
    return (
      <Panel>
        <h2 className="type-heading text-text-hi">{t("phone.title")}</h2>
        <p className="text-text-mid mt-3 max-w-xl leading-[1.6]">{t("phone.body")}</p>
      </Panel>
    )
  }
  const { primary } = choice
  if (primary === null) {
    return (
      <Panel>
        <h2 className="type-heading text-text-hi">{t("noInstaller.title")}</h2>
        <p className="text-text-mid mt-3 max-w-xl leading-[1.6]">{t("noInstaller.body")}</p>
      </Panel>
    )
  }

  const size = formatInstallerSize(primary.size, locale)
  const meta = {
    version: release.version,
    arch: t(`arch.${platformKey(primary)}`),
    size,
  }
  const intel = choice.archAssumed
    ? choice.rest.find((installer) => installer.os === "macos" && installer.arch === "x64")
    : undefined

  return (
    <Panel>
      <Button size="lg" asChild>
        <a data-testid="download-primary" href={primary.url}>
          {t("primary.button", { os: t(`os.${primary.os}`) })}
        </a>
      </Button>
      <p data-testid="download-primary-meta" className="text-text-lo mt-4 font-mono text-sm">
        {size === "" ? t("primary.metaNoSize", meta) : t("primary.meta", meta)}
      </p>
      {intel ? (
        <p className="text-text-mid mt-4 text-sm">
          {t("primary.intelPrompt")}{" "}
          <a href={intel.url} className="text-accent underline-grow">
            {t("primary.intelLink")}
          </a>
        </p>
      ) : null}
      <p className="text-text-lo mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {release.releasedAt === null ? null : (
          <span>
            {t("primary.released", {
              date: format.dateTime(new Date(release.releasedAt), {
                dateStyle: "long",
                timeZone: "UTC",
              }),
            })}
          </span>
        )}
        {release.notesUrl === null ? null : (
          <a href={release.notesUrl} className="text-text-mid hover:text-text-hi underline-grow">
            {t("primary.notes")}
          </a>
        )}
      </p>
    </Panel>
  )
}
