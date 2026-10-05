import type { Metadata } from "next"
import type { JSX } from "react"

import { CraftedSection } from "@/components/landing/sections/crafted"
import { CtaSection } from "@/components/landing/sections/cta"
import { HeroSection } from "@/components/landing/sections/hero"
import { KibitzerSection } from "@/components/landing/sections/kibitzer"
import { MassUlwSection } from "@/components/landing/sections/mass-ulw"
import { MultiModelSection } from "@/components/landing/sections/multi-model"
import { PlatformsSection } from "@/components/landing/sections/platforms"
import { ProofStripSection } from "@/components/landing/sections/proof-strip"
import { ReviewsSection } from "@/components/landing/sections/reviews"
import { SecretSection } from "@/components/landing/sections/secret"
import { SkillsSection } from "@/components/landing/sections/skills"
import { UltraworkSection } from "@/components/landing/sections/ultrawork"
import { getStats, FALLBACK_DESCRIPTION } from "@/lib/stats"

export async function generateLandingMetadata(): Promise<Metadata> {
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh landing metadata; using fallback description", error)
  }

  return {
    title: "OmO — Your tool for real work. But it's an agent.",
    description,
  }
}

export async function LandingPage(): Promise<JSX.Element> {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <HeroSection />
      <ProofStripSection />
      <SecretSection />
      <UltraworkSection />
      <MultiModelSection />
      <MassUlwSection />
      <KibitzerSection />
      <SkillsSection />
      <CraftedSection />
      <PlatformsSection />
      <ReviewsSection />
      <CtaSection />
    </div>
  )
}
