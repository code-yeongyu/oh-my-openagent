import type { JSX } from "react"
import { hasLocale, useLocale } from "next-intl"
import { NotFoundView } from "@/app/_components/not-found-view"
import { routing } from "@/i18n/routing"

export default function LocaleNotFound(): JSX.Element {
  const locale = useLocale()
  return (
    <NotFoundView locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale} />
  )
}
