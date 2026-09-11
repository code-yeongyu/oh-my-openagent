import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { Reveal } from "@/components/landing/motion-wrappers"
import { SectionHeader } from "@/components/landing/section-header"
import { Frame } from "@/components/ledger/frame"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { Chip } from "@/components/ui/badge"

/**
 * The three builtin model profiles in picker order, with the length of each chain
 * (`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts`). The chain names
 * live in `landing.profiles.<key>.models` of every locale file.
 */
const PROFILE_ROWS = [
  { key: "capable", rungs: [0, 1, 2, 3] },
  { key: "simpleWork", rungs: [0, 1, 2] },
  { key: "deepWork", rungs: [0, 1] },
] as const

/** An ordered chain: the first rung the live registry serves wins, the rest are fallbacks. */
function Chain({ models }: { readonly models: readonly string[] }): JSX.Element {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {models.map((model, index) => (
        <li key={model} className="flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden="true" className="text-text-faint text-meta font-mono">
              →
            </span>
          ) : null}
          <Chip>{model}</Chip>
        </li>
      ))}
    </ol>
  )
}

/**
 * Model profiles as a ledger next to the roster: one row per builtin profile, its intent in the
 * explanation column and the ordered model chain as evidence. A separate section on purpose -
 * the 11-node graph and its gapless bento stay untouched.
 */
export async function ProfilesSection(): Promise<JSX.Element> {
  const t = await getTranslations("landing.profiles")

  return (
    <section
      id="profiles"
      data-section="profiles"
      aria-labelledby="profiles-title"
      className="border-line border-t py-16 lg:py-24"
    >
      <Frame>
        <Reveal>
          <SectionHeader
            id="profiles-title"
            eyebrow={t("eyebrow")}
            title={t("title")}
            intro={t("subtitle")}
          />
        </Reveal>
        <Reveal index={1} className="mt-12">
          {PROFILE_ROWS.map((row, index) => (
            <LedgerRow
              key={row.key}
              index={`0${index + 1}`}
              title={t(`${row.key}.name`)}
              evidence={<Chain models={row.rungs.map((i) => t(`${row.key}.models.${i}`))} />}
            >
              {t(`${row.key}.role`)}
            </LedgerRow>
          ))}
        </Reveal>
      </Frame>
    </section>
  )
}
