import type { JSX } from "react"
import { CheckCircle2, CreditCard, Settings2 } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { CheckoutLeadForm } from "@/components/landing/checkout-lead-form"

export async function CheckoutPipelineSection(): Promise<JSX.Element> {
  const t = await getTranslations("onboarding.landing")

  return (
    <section className="bg-[#0a0a0a] py-24" data-section="checkout-pipeline" id="checkout-pipeline">
      <div className="reveal-on-enter container mx-auto px-4 md:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300">
              <Settings2 className="h-4 w-4" />
              {t("badge")}
            </div>
            <div className="space-y-4">
              <h2 className="max-w-3xl text-4xl font-bold tracking-tight text-white md:text-5xl">
                {t("title")}
              </h2>
              <p className="max-w-2xl text-lg leading-8 text-zinc-400">{t("description")}</p>
            </div>
            <div className="max-w-2xl">
              <CheckoutLeadForm />
              <p className="mt-3 text-sm text-zinc-500">{t("finePrint")}</p>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-5 shadow-2xl shadow-cyan-950/20">
            <div className="space-y-4">
              <PipelineStep
                icon={<CheckCircle2 className="h-4 w-4" />}
                title={t("steps.capture")}
              />
              <PipelineStep icon={<CreditCard className="h-4 w-4" />} title={t("steps.checkout")} />
              <PipelineStep icon={<Settings2 className="h-4 w-4" />} title={t("steps.configure")} />
            </div>
            <div className="mt-6 rounded-md border border-zinc-800 bg-black p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
                <span>{t("preview.label")}</span>
                <span>{t("preview.status")}</span>
              </div>
              <div className="space-y-3">
                <PreviewToggle label={t("preview.landing")} />
                <PreviewToggle label={t("preview.email")} />
                <PreviewToggle label={t("preview.analytics")} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PipelineStep({
  icon,
  title,
}: {
  readonly icon: JSX.Element
  readonly title: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-black/50 p-4 text-zinc-200">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300">
        {icon}
      </div>
      <span className="font-medium">{title}</span>
    </div>
  )
}

function PreviewToggle({ label }: { readonly label: string }): JSX.Element {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 rounded-md bg-zinc-900 px-3 text-sm text-zinc-300">
      <span>{label}</span>
      <span className="h-5 w-9 rounded-full bg-cyan-500 p-0.5">
        <span className="block h-4 w-4 translate-x-4 rounded-full bg-black" />
      </span>
    </div>
  )
}
