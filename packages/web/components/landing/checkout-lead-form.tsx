"use client"

import type { JSX } from "react"
import { CreditCard, Mail } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { defaultLocale } from "@/i18n/config"

function getCheckoutAction(locale: string): string {
  if (locale === defaultLocale) {
    return "/checkout"
  }
  return `/${locale}/checkout`
}

export function CheckoutLeadForm(): JSX.Element {
  const t = useTranslations("onboarding.form")
  const locale = useLocale()

  return (
    <form
      action={getCheckoutAction(locale)}
      method="get"
      className="grid gap-3 rounded-lg border border-zinc-800 bg-black/60 p-3 sm:grid-cols-[1fr_auto]"
    >
      <label className="sr-only" htmlFor="checkout-email">
        {t("emailLabel")}
      </label>
      <div className="relative">
        <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          id="checkout-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="h-12 rounded-md border-zinc-700 bg-zinc-950 pl-10 text-white placeholder:text-zinc-500"
        />
      </div>
      <Button
        type="submit"
        size="lg"
        className="h-12 bg-cyan-500 px-6 font-bold text-black hover:bg-cyan-600"
      >
        <CreditCard className="h-4 w-4" />
        {t("submit")}
      </Button>
    </form>
  )
}
