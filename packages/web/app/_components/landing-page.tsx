import type { Metadata } from "next"
import type { JSX } from "react"

import { AgentsSection } from "@/components/landing/sections/agents"
import { CtaSection } from "@/components/landing/sections/cta"
import { EditionsSection } from "@/components/landing/sections/editions"
import { HeroSection } from "@/components/landing/sections/hero"
import { MassUlwSection } from "@/components/landing/sections/mass-ulw"
import { OrchestrationSection } from "@/components/landing/sections/orchestration"
import { PrinciplesSection } from "@/components/landing/sections/principles"
import { ProofStripSection } from "@/components/landing/sections/proof-strip"
import { ReviewsSection } from "@/components/landing/sections/reviews"
import { TeamModeSection } from "@/components/landing/sections/team-mode"
import { getStats, FALLBACK_DESCRIPTION } from "@/lib/stats"

export async function generateLandingMetadata(): Promise<Metadata> {
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh landing metadata; using fallback description", error)
  }

  return {
    title: "Oh My OpenAgent — The Agent Harness",
    description,
  }
}

export async function LandingPage(): Promise<JSX.Element> {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <HeroSection />
      <ProofStripSection />
      <MassUlwSection />
      <EditionsSection />
      <AgentsSection />
      <OrchestrationSection />
      <TeamModeSection />
      <PrinciplesSection />
      <ReviewsSection />
      <CtaSection />
    </div>
  )
}
