import { px, styleOf } from "../../../core/page"
import type { ElementSnapshot } from "../../../types"

const WIDE = /[\u1100-\u115f\u2e80-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3ffff}]/u

const advanceBoundEm = (c: string): number => (WIDE.test(c) ? 1.05 : c !== c.toLowerCase() && c === c.toUpperCase() ? 0.8 : 0.7)

/** A wrapping flex row whose own text is two or more runs, each short enough to sit on one line of the row: the runs move whole, so no line of one run crowds another. */
export function itemsEachFitOneLine(element: ElementSnapshot, fontSize: number): boolean {
	if (!["flex", "inline-flex"].includes(styleOf(element, "display"))) return false
	if (!styleOf(element, "flex-wrap").startsWith("wrap")) return false
	if (element.textRuns.length < 2) return false
	const content = element.scroll.clientWidth - Math.max(0, px(styleOf(element, "padding-left")) ?? 0) - Math.max(0, px(styleOf(element, "padding-right")) ?? 0)
	if (!(Number.isFinite(content) && content > 0 && fontSize > 0)) return false
	return element.textRuns.every((run) => [...run].reduce((w, c) => w + advanceBoundEm(c), 0) * fontSize < content)
}
