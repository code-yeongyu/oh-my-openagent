import type { Metadata } from "next"
import type { JSX } from "react"
import { CreditCard, Mail, ShieldCheck } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { getCustomerEmail, type SearchParams } from "@/lib/onboarding"

export const metadata: Metadata = {
  title: "Checkout - Oh My OpenAgent",
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>
  readonly searchParams: Promise<SearchParams>
}): Promise<JSX.Element> {
  const { locale } = await params
  const customerEmail = getCustomerEmail(await searchParams)
  const t = await getTranslations("onboarding.checkout")

  setRequestLocale(locale)

  return (
    <div className="bg-black py-20">
      <section className="container mx-auto px-4 md:px-6">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_0.85fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300">
              <CreditCard className="h-4 w-4" />
              {t("badge")}
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
                {t("title")}
              </h1>
              <p className="text-lg leading-8 text-zinc-400">{t("description")}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
              <div className="flex items-center gap-3 text-zinc-200">
                <Mail className="h-4 w-4 text-cyan-300" />
                <span>{customerEmail || t("missingEmail")}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-6">
            <div className="mb-6 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-cyan-300" />
              <h2 className="text-xl font-bold text-white">{t("summaryTitle")}</h2>
            </div>
            <div className="space-y-4 text-sm text-zinc-400">
              <SummaryRow label={t("summary.product")} value={t("summary.productValue")} />
              <SummaryRow label={t("summary.payment")} value={t("summary.paymentValue")} />
              <SummaryRow label={t("summary.delivery")} value={t("summary.deliveryValue")} />
            </div>
            <Link href={`/result?email=${encodeURIComponent(customerEmail)}&status=paid`}>
              <Button className="mt-6 h-12 w-full bg-cyan-500 font-bold text-black hover:bg-cyan-600">
                {t("confirmPayment")}
              </Button>
            </Link>
            <p className="mt-3 text-xs leading-5 text-zinc-600">{t("stubNotice")}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function SummaryRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4 last:border-b-0 last:pb-0">
      <span>{label}</span>
      <span className="font-medium text-zinc-200">{value}</span>
    </div>
  )
}
