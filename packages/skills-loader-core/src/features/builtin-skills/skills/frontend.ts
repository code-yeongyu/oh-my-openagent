import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendSkill: BuiltinSkill = {
	name: "frontend",
	description: "MUST USE for frontend/web UI/UX/visual work: building, styling, redesigning pages/components, React setup, performance audits, visual QA, taste, and polish. Routes four rulesets: design taste router and brand references; perfection for Playwright/Chromium Lighthouse/Core Web Vitals; ui-ux-db palettes/fonts/guidelines; designpowers personas/accessibility/critique/handoff. Triggers: frontend, UI, UX, design, redesign, styling, layout, animation, motion, premium, luxury, minimal, brutalist, Awwwards, DESIGN.md, mockup, React, Lighthouse, accessibility, WCAG, Core Web Vitals, looks generic, make it pretty, like X brand.",
	template: loadSharedSkillTemplate("frontend"),
}
