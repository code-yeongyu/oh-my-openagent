"use client"

import type { JSX } from "react"
import { useState } from "react"
import { Check, Mail, Rocket, Settings2 } from "lucide-react"
import { useTranslations } from "next-intl"

const AUTOMATION_ITEMS = [
  { key: "landing", icon: Rocket },
  { key: "email", icon: Mail },
  { key: "analytics", icon: Settings2 },
] as const

type AutomationKey = (typeof AUTOMATION_ITEMS)[number]["key"]

const DEFAULT_ENABLED: Readonly<Record<AutomationKey, boolean>> = {
  landing: true,
  email: true,
  analytics: false,
}

export function AutomationTogglePanel({
  customerEmail,
}: {
  readonly customerEmail: string
}): JSX.Element {
  const t = useTranslations("onboarding.result")
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED)

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-cyan-300">{t("workspaceLabel")}</p>
          <p className="mt-1 text-sm text-zinc-400">{customerEmail || t("fallbackEmail")}</p>
        </div>
        <div className="rounded-md bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300">
          {t("status")}
        </div>
      </div>
      <div className="space-y-3">
        {AUTOMATION_ITEMS.map((item) => {
          const Icon = item.icon
          const isEnabled = enabled[item.key]
          return (
            <button
              key={item.key}
              type="button"
              role="switch"
              aria-checked={isEnabled}
              aria-label={t(`toggles.${item.key}.title`)}
              onClick={() =>
                setEnabled((current) => ({ ...current, [item.key]: !current[item.key] }))
              }
              className="flex w-full items-center justify-between gap-4 rounded-md border border-zinc-800 bg-black p-4 text-left transition-colors hover:border-cyan-500/40"
            >
              <span className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-cyan-300">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block font-semibold text-white">
                    {t(`toggles.${item.key}.title`)}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-500">
                    {t(`toggles.${item.key}.description`)}
                  </span>
                </span>
              </span>
              <span
                className={
                  "flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors " +
                  (isEnabled ? "bg-cyan-500" : "bg-zinc-700")
                }
              >
                <span
                  className={
                    "flex h-5 w-5 items-center justify-center rounded-full bg-black transition-transform " +
                    (isEnabled ? "translate-x-5 text-cyan-300" : "translate-x-0 text-zinc-500")
                  }
                >
                  {isEnabled ? <Check className="h-3 w-3" /> : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
