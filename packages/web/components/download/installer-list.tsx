import type { JSX } from "react"
import { useLocale, useTranslations } from "next-intl"

import { formatInstallerSize, platformKey, type DesktopInstaller } from "@/lib/desktop-download"

export function InstallerList({
  installers,
}: {
  readonly installers: readonly DesktopInstaller[]
}): JSX.Element {
  const t = useTranslations("download")
  const locale = useLocale()

  return (
    <ul className="border-line border-t">
      {installers.map((installer) => (
        <li
          key={installer.url}
          data-testid="installer-row"
          className="border-line grid min-w-0 gap-x-8 gap-y-2 border-b py-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <p className="text-text-hi font-medium">
              {t(`os.${installer.os}`)} · {t(`arch.${platformKey(installer)}`)}
            </p>
            <p className="text-text-lo mt-1 text-sm">
              {t(`kinds.${installer.kind}`)}
              {installer.size === null ? "" : ` · ${formatInstallerSize(installer.size, locale)}`}
            </p>
          </div>
          <div className="min-w-0">
            <a
              href={installer.url}
              className="text-text-hi hover:text-accent focus-visible:outline-accent-32 ease-standard font-mono text-sm break-all underline decoration-[var(--line-strong)] underline-offset-4 transition-colors duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {installer.fileName}
            </a>
            <p className="text-text-lo mt-2 font-mono text-xs break-all">
              <span className="eyebrow mr-2">{t("all.sha")}</span>
              <code className="text-text-mid">{installer.sha256}</code>
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
