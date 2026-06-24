import type { Brain } from "lucide-react"
import {
  Check,
  Eye,
  Search,
  Code2,
  MessageSquare,
  Target,
  Shield,
  Lightbulb,
  Zap,
  Route,
  HardDrive,
} from "lucide-react"

export const SUB_AGENT_KEYS = ["oracle", "librarian", "explore", "metis", "momus"] as const
export type SubAgentKey = (typeof SUB_AGENT_KEYS)[number]

type AgentStyle = {
  readonly color: string
  readonly border: string
  readonly bg: string
  readonly icon: typeof Brain
}

// Consolidated: single secondary accent (violet) for all sub-agents.
// The visual differentiation comes from the icon, not a rainbow of colors.
export const AGENT_STYLES: Readonly<Record<SubAgentKey, AgentStyle>> = {
  oracle: { color: "text-violet-300", border: "border-zinc-800", bg: "bg-violet-400/5", icon: Eye },
  librarian: {
    color: "text-violet-300",
    border: "border-zinc-800",
    bg: "bg-violet-400/5",
    icon: Search,
  },
  explore: {
    color: "text-violet-300",
    border: "border-zinc-800",
    bg: "bg-violet-400/5",
    icon: Code2,
  },
  metis: {
    color: "text-violet-300",
    border: "border-zinc-800",
    bg: "bg-violet-400/5",
    icon: MessageSquare,
  },
  momus: {
    color: "text-violet-300",
    border: "border-zinc-800",
    bg: "bg-violet-400/5",
    icon: Check,
  },
}

export const PRINCIPLE_KEYS = [
  "specialization",
  "trustVerify",
  "wisdom",
  "modelOptimization",
  "categories",
  "continuity",
] as const
export type PrincipleKey = (typeof PRINCIPLE_KEYS)[number]

export const PRINCIPLE_ICONS: Readonly<Record<PrincipleKey, typeof Brain>> = {
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

export const CATEGORY_ROUTING = [
  { cat: "visual-engineering", model: "Gemini 3.1 Pro" },
  { cat: "ultrabrain", model: "GPT 5.5 xHigh" },
  { cat: "artistry", model: "Gemini 3.1 Pro" },
  { cat: "quick", model: "GPT 5.4 Mini" },
  { cat: "deep", model: "GPT 5.5 Medium" },
  { cat: "writing", model: "Kimi K2.5" },
  { cat: "git", model: "Claude Haiku 4.5" },
] as const

export const SKILL_INJECTIONS = ["playwright", "git-master", "frontend", "team-mode"] as const
