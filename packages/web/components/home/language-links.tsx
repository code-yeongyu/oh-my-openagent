"use client"

import type { JSX } from "react"
import { useLocale } from "next-intl"

import { localeNames, locales } from "@/i18n/config"
import { Link, usePathname } from "@/i18n/routing"

/** Each language links to the page the reader is on, in that language. */
export function LanguageLinks({ label }: { readonly label: string }): JSX.Element {
  const current = useLocale()
  const pathname = usePathname()

  return (
    <nav aria-label={label} className="footer__langs">
      {locales.map((code) => (
        <Link
          key={code}
          href={pathname}
          locale={code}
          lang={code}
          hrefLang={code}
          aria-current={code === current ? "true" : undefined}
        >
          {localeNames[code]}
        </Link>
      ))}
    </nav>
  )
}
