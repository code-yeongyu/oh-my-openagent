import type { JSX } from "react"
import { useLocale, useTranslations } from "next-intl"

import {
  formatInstallerSize,
  platformKey,
  type DesktopInstaller,
  type DesktopOs,
} from "@/lib/desktop-download"

const ALL_OS: readonly DesktopOs[] = ["macos", "windows", "linux"]

export function InstallerList({
  installers,
}: {
  readonly installers: readonly DesktopInstaller[]
}): JSX.Element {
  const t = useTranslations("download")
  const locale = useLocale()
  const missing = ALL_OS.filter((os) => !installers.some((installer) => installer.os === os))
  const linuxKinds = new Set(installers.filter((i) => i.os === "linux").map((i) => i.kind))

  return (
    <>
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
        {missing.map((os) => (
          <li
            key={os}
            data-testid="missing-os-row"
            className="border-line text-text-lo border-b py-5 lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-x-8"
          >
            <p className="text-text-mid font-medium">{t(`os.${os}`)}</p>
            <p className="text-sm">{t("all.missing")}</p>
          </li>
        ))}
      </ul>
      {linuxKinds.has("deb") && linuxKinds.has("appimage") ? (
        <p
          data-testid="linux-pick-note"
          className="text-text-mid mt-4 max-w-2xl text-sm leading-[1.6]"
        >
          {t("all.linuxPick")}
        </p>
      ) : null}
    </>
  )
}
