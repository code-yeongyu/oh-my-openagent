import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendSkill: BuiltinSkill = {
	name: "frontend",
	description: "MUST USE for ANY frontend, web UI, UX, or visual work — building, styling, or redesigning pages/components, React project setup, performance audits, design QA. Routes three rulesets: design (anti-slop taste router over 12 taste skills + 69 brand DESIGN.md refs — Apple, Stripe, Linear, Notion, Vercel, Claude, Nike — plus React dev tooling gate: react-grab, react-scan, react-doctor), perfection (Lighthouse 100 in every category via real Playwright Chromium audits, NEVER the lighthouse CLI, never by weakening UX), ui-ux-db (searchable 50+ styles, 97 palettes, 57 font pairings, 99 UX guidelines). Triggers: frontend, UI, UX, design, redesign, styling, layout, animation, motion, taste, premium, luxury, minimal, brutalist, Awwwards, anti-slop, polish, DESIGN.md, mockup, react setup, react-scan, react-doctor, lighthouse, performance, Core Web Vitals, LCP, CLS, INP, SEO, accessibility, a11y, WCAG, audit my site, make this faster, color palette, font pairing, looks generic, make it pretty, like X brand.",
	template: loadSharedSkillTemplate("frontend"),
}
