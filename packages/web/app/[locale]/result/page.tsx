import type { Metadata } from "next"
import type { JSX } from "react"
import { CheckCircle2 } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AutomationTogglePanel } from "@/components/onboarding/automation-toggle-panel"
import { getCustomerEmail, type SearchParams } from "@/lib/onboarding"

export const metadata: Metadata = {
  title: "Automation Workspace - Oh My OpenAgent",
}

export default async function ResultPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>
  readonly searchParams: Promise<SearchParams>
}): Promise<JSX.Element> {
  const { locale } = await params
  const customerEmail = getCustomerEmail(await searchParams)
  const t = await getTranslations("onboarding.result")

  setRequestLocale(locale)

  return (
    <div className="bg-black py-20">
      <section className="container mx-auto px-4 md:px-6">
        <div className="mx-auto grid max-w-6xl items-start gap-8 lg:grid-cols-[0.9fr_1fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300">
              <CheckCircle2 className="h-4 w-4" />
              {t("badge")}
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
                {t("title")}
              </h1>
              <p className="text-lg leading-8 text-zinc-400">{t("description")}</p>
            </div>
            <div className="grid gap-3 text-sm text-zinc-400 sm:grid-cols-3">
              <Metric label={t("metrics.checkout")} value={t("metrics.checkoutValue")} />
              <Metric label={t("metrics.email")} value={t("metrics.emailValue")} />
              <Metric label={t("metrics.iteration")} value={t("metrics.iterationValue")} />
            </div>
          </div>
          <AutomationTogglePanel customerEmail={customerEmail} />
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs tracking-wide text-zinc-600 uppercase">{label}</p>
      <p className="mt-2 font-semibold text-white">{value}</p>
    </div>
  )
}
