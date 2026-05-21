import type { Metadata } from "next"
import type { JSX } from "react"
import { ArchitectureSection } from "@/components/landing/sections/architecture"
import { CtaSection } from "@/components/landing/sections/cta"
import { HephaestusSection } from "@/components/landing/sections/hephaestus"
import { HeroSection } from "@/components/landing/sections/hero"
import { PrometheusAtlasSection } from "@/components/landing/sections/prometheus-atlas"
import { ReviewsSection } from "@/components/landing/sections/reviews"
import { SisyphusSection } from "@/components/landing/sections/sisyphus"
import { SubAgentsSection } from "@/components/landing/sections/sub-agents"
import { TeamModeSection } from "@/components/landing/sections/team-mode"
import { UltraworkSection } from "@/components/landing/sections/ultrawork"

export const landingMetadata: Metadata = {
  title: "Oh My OpenAgent — The Best Agent Harness",
  description:
    "Meet Sisyphus: The batteries-included agent that codes like you. Multi-model orchestration, Team Mode, background agents, 55+ lifecycle hooks.",
}

export async function LandingPage(): Promise<JSX.Element> {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <link rel="preload" as="image" href="/images/hero.webp" fetchPriority="low" />
      <HeroSection />
      <UltraworkSection />
      <SisyphusSection />
      <PrometheusAtlasSection />
      <HephaestusSection />
      <TeamModeSection />
      <SubAgentsSection />
      <ArchitectureSection />
      <ReviewsSection />
      <CtaSection />
    </div>
  )
}
