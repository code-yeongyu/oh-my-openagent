import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/routing"

export async function Footer({ locale }: { locale?: string } = {}) {
  const t = locale
    ? await getTranslations({ locale, namespace: "footer" })
    : await getTranslations("footer")
  const currentYear = new Date().getUTCFullYear()

  return (
    <footer className="border-t border-white/10 bg-black py-12">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex flex-col gap-2">
            <span className="text-lg font-bold text-white">{t("brand")}</span>
            <p className="text-sm text-zinc-400">
              {t("copyright", { year: currentYear.toString() })}
            </p>
          </div>
          <div className="flex items-center gap-8 text-sm text-zinc-400">
            <a
              href="https://github.com/code-yeongyu/oh-my-openagent"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cyan-400"
            >
              {t("github")}
            </a>
            <a
              href="https://discord.gg/indentcorp"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cyan-400"
            >
              {t("discord")}
            </a>
            <Link href="/docs" locale={locale} className="transition-colors hover:text-cyan-400">
              {t("documentation")}
            </Link>
            <Link
              href="/manifesto"
              locale={locale}
              className="transition-colors hover:text-cyan-400"
            >
              {t("manifesto")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
