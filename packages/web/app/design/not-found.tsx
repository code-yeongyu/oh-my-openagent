import type { JSX } from "react"
import { NotFoundView } from "@/app/_components/not-found-view"
import { defaultLocale } from "@/i18n/config"

export default function DesignNotFound(): JSX.Element {
  return <NotFoundView locale={defaultLocale} />
}
