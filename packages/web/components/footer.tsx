import type { JSX } from "react"
import Image from "next/image"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/routing"

const GITHUB_URL = "https://github.com/code-yeongyu/oh-my-openagent"
const LEGAL_BASE = `${GITHUB_URL}/blob/dev/docs/legal`

type FooterKey =
  | "product"
  | "community"
  | "legal"
  | "docs"
  | "manifesto"
  | "releases"
  | "github"
  | "discord"
  | "x"
  | "privacy"
  | "terms"

interface FooterLink {
  readonly key: FooterKey
  readonly href: string
  readonly external?: boolean
}

interface FooterGroup {
  readonly key: FooterKey
  readonly links: readonly FooterLink[]
}

const GROUPS: readonly FooterGroup[] = [
  {
    key: "product",
    links: [
      { key: "docs", href: "/docs" },
      { key: "manifesto", href: "/manifesto" },
      { key: "releases", href: `${GITHUB_URL}/releases`, external: true },
    ],
  },
  {
    key: "community",
    links: [
      { key: "github", href: GITHUB_URL, external: true },
      { key: "discord", href: "https://discord.gg/PUwSMR9XNk", external: true },
      { key: "x", href: "https://x.com/justsisyphus", external: true },
    ],
  },
  {
    key: "legal",
    links: [
      { key: "privacy", href: `${LEGAL_BASE}/privacy-policy.md`, external: true },
      { key: "terms", href: `${LEGAL_BASE}/terms-of-service.md`, external: true },
    ],
  },
]

const LINK_CLASS =
  "text-text-lo hover:text-text-hi focus-visible:outline-accent-32 inline-flex min-h-6 items-center text-sm transition-colors duration-[var(--dur-micro)] ease-standard focus-visible:outline-2 focus-visible:outline-offset-2"

/** DESIGN.md §5 Footer: top hairline, py-12, 2 → 4 columns, mono meta copyright. */
export async function Footer({ locale }: { readonly locale?: string } = {}): Promise<JSX.Element> {
  const t = locale
    ? await getTranslations({ locale, namespace: "footer" })
    : await getTranslations("footer")
  const year = new Date().getUTCFullYear().toString()

  return (
    <footer className="border-line bg-ink-0 border-t py-12">
      <div className="mx-auto grid w-full max-w-[90rem] grid-cols-2 gap-x-6 gap-y-10 px-4 sm:px-5 lg:grid-cols-4 lg:px-8">
        <div className="col-span-2 flex flex-col gap-4 lg:col-span-1">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/omo-mark.svg" alt="" width={24} height={24} />
            <span className="text-text-hi text-[15px] font-medium tracking-[-0.02em]">
              {t("brand")}
            </span>
          </div>
          <p className="text-text-lo text-meta tracking-meta font-mono">
            {t("copyright", { year })}
          </p>
        </div>

        {GROUPS.map((group) => (
          <nav
            key={group.key}
            aria-labelledby={`footer-${group.key}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`footer-${group.key}`} className="eyebrow">
              {t(group.key)}
            </h2>
            <ul className="flex flex-col gap-2">
              {group.links.map((link) => (
                <li key={link.key}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK_CLASS}
                    >
                      {t(link.key)}
                    </a>
                  ) : (
                    <Link href={link.href} locale={locale} className={LINK_CLASS}>
                      {t(link.key)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  )
}
