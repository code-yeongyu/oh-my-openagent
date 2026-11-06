"use client"

import type { JSX } from "react"
import { useLocale } from "next-intl"

import { localeNames, locales } from "@/i18n/config"
import { Link, usePathname } from "@/i18n/routing"

export function LanguageLinks({
  label,
  linkClassName,
}: {
  readonly label: string
  readonly linkClassName: string
}): JSX.Element {
  const current = useLocale()
  const pathname = usePathname()

  return (
    <nav aria-labelledby="footer-language" className="flex flex-col gap-3">
      <h2 id="footer-language" className="eyebrow">
        {label}
      </h2>
      <ul className="-my-2 flex flex-col">
        {locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              lang={locale}
              hrefLang={locale}
              aria-current={locale === current ? "true" : undefined}
              className={linkClassName}
            >
              {localeNames[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
