import type { Metadata } from "next"
import type { JSX } from "react"
import { getTranslations } from "next-intl/server"

import { ClosingSection } from "@/components/home/sections/closing"
import { CraftedSection } from "@/components/home/sections/crafted"
import { EverywhereSection } from "@/components/home/sections/everywhere"
import { HeroSection } from "@/components/home/sections/hero"
import { IndexStrip } from "@/components/home/sections/index-strip"
import { KibitzerSection } from "@/components/home/sections/kibitzer"
import { MakersSection } from "@/components/home/sections/makers"
import { MassUlwSection } from "@/components/home/sections/mass-ulw"
import { ModelsSection } from "@/components/home/sections/models"
import { SkillsSection } from "@/components/home/sections/skills"
import { UltraworkSection } from "@/components/home/sections/ultrawork"
import { VoicesSection } from "@/components/home/sections/voices"
import { HomeFooter } from "@/components/home/home-footer"
import { HomeNav } from "@/components/home/home-nav"
import { RevealObserver } from "@/components/home/reveal-observer"
import { FALLBACK_DESCRIPTION, FALLBACK_FORMATTED_STATS, formatStats, getStats } from "@/lib/stats"

export async function generateHomeMetadata(): Promise<Metadata> {
  const t = await getTranslations("home")
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh home metadata; using fallback description", error)
  }
  return { title: t("metaTitle"), description }
}

async function loadStats(): Promise<typeof FALLBACK_FORMATTED_STATS> {
  try {
    return formatStats(await getStats())
  } catch (error) {
    console.warn("Unable to load live numbers for the home page; using fallback", error)
    return FALLBACK_FORMATTED_STATS
  }
}

export async function HomePage(): Promise<JSX.Element> {
  const t = await getTranslations("home.nav")
  const stats = await loadStats()

  return (
    <>
      <a className="skip" href="#main">
        {t("skip")}
      </a>
      <HomeNav stars={stats.stars} />
      <main id="main" tabIndex={-1}>
        <HeroSection />
        <IndexStrip stats={stats} />
        <UltraworkSection />
        <MassUlwSection />
        <ModelsSection />
        <KibitzerSection />
        <SkillsSection />
        <CraftedSection />
        <EverywhereSection />
        <VoicesSection />
        <MakersSection />
        <ClosingSection />
      </main>
      <HomeFooter />
      <RevealObserver />
    </>
  )
}
