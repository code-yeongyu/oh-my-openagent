import type { JSX } from "react"
import { useTranslations } from "next-intl"

type VerifyOs = "macos" | "windows" | "linux"

const COMMANDS: Readonly<Record<VerifyOs, (file: string) => string>> = {
  macos: (file) => `shasum -a 256 ${file}`,
  windows: (file) => `Get-FileHash ${file} -Algorithm SHA256`,
  linux: (file) => `sha256sum ${file}`,
}
const ORDER: readonly VerifyOs[] = ["macos", "windows", "linux"]

export function VerifyDownload({
  fileNames,
  checksumsUrl,
}: {
  readonly fileNames: Readonly<Record<VerifyOs, string>>
  readonly checksumsUrl: string
}): JSX.Element {
  const t = useTranslations("download.verify")

  return (
    <div>
      <h2 className="type-heading text-text-hi">{t("title")}</h2>
      <p className="text-text-mid mt-3 max-w-2xl leading-[1.6]">{t("body")}</p>
      <div className="mt-6 grid max-w-3xl gap-4">
        {ORDER.map((os) => (
          <div key={os} className="border-line bg-ink-1 min-w-0 border p-4">
            <p className="eyebrow text-text-lo">{t(os)}</p>
            <pre className="mt-3 overflow-x-auto font-mono text-sm leading-[1.55]">
              <code className="text-text-hi">{COMMANDS[os](fileNames[os])}</code>
            </pre>
          </div>
        ))}
      </div>
      <p className="text-text-mid mt-4 max-w-2xl text-sm leading-[1.6]">{t("mismatch")}</p>
      <a
        href={checksumsUrl}
        className="text-text-mid hover:text-text-hi underline-grow mt-4 inline-block font-mono text-xs uppercase"
      >
        {t("checksums")}
      </a>
    </div>
  )
}
