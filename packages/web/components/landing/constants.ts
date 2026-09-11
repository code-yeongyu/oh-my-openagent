import type { LucideIcon } from "lucide-react"
import { HardDrive, Lightbulb, Route, Shield, Target, Zap } from "lucide-react"

export const PRINCIPLE_KEYS = [
  "specialization",
  "trustVerify",
  "wisdom",
  "modelOptimization",
  "categories",
  "continuity",
] as const
export type PrincipleKey = (typeof PRINCIPLE_KEYS)[number]

export const PRINCIPLE_ICONS: Readonly<Record<PrincipleKey, LucideIcon>> = {
  specialization: Target,
  trustVerify: Shield,
  wisdom: Lightbulb,
  modelOptimization: Zap,
  categories: Route,
  continuity: HardDrive,
}

export const REVIEW_KEYS = [
  "review1",
  "review2",
  "review3",
  "review4",
  "review5",
  "review6",
] as const
export type ReviewKey = (typeof REVIEW_KEYS)[number]

export const ORCHESTRATION_KEYS = ["planner", "planConsultant", "planReviewer", "executor"] as const
export type OrchestrationKey = (typeof ORCHESTRATION_KEYS)[number]

/** Evidence for the "Category system" principle row. */
export const CATEGORY_ROUTING = [
  { cat: "visual-engineering", model: "Claude Fable 5.1 Max" },
  { cat: "ultrabrain", model: "GPT 6 Astra Max" },
  { cat: "artistry", model: "Claude Fable 5.1 Max" },
  { cat: "quick", model: "Kimi For Coding Highspeed" },
  { cat: "deep", model: "GPT 6 Astra High" },
  { cat: "writing", model: "Claude Fable 5.1 Medium" },
  { cat: "unspecified-low", model: "Grok 4.6 xHigh" },
] as const

/** Evidence for the "Specialization" principle row. */
export const SKILL_INJECTIONS = ["playwright", "git-master", "frontend", "team-mode"] as const

export const INSTALL_TAB_IDS = ["opencode", "codex", "senpi"] as const
export type InstallTabId = (typeof INSTALL_TAB_IDS)[number]
