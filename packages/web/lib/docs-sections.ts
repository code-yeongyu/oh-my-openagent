import { DOC_GUIDE_PAGES_DATA, DOC_SECTIONS_DATA } from "./docs-sections-data.mjs"

export const DOC_SECTIONS = DOC_SECTIONS_DATA

export const DOC_SECTION_IDS = DOC_SECTIONS.map((s) => s.id)

export type DocSectionId = (typeof DOC_SECTIONS)[number]["id"]
export type DocSection = (typeof DOC_SECTIONS)[number]

export const DOC_GUIDE_PAGES = DOC_GUIDE_PAGES_DATA

export type DocGuidePage = (typeof DOC_GUIDE_PAGES)[number]
