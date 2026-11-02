import type { Rule } from "../rule"
import { COLOR_RULES } from "./color"
import { TYPOGRAPHY_RULES } from "./typography"
import { LAYOUT_RULES } from "./layout"
import { DECORATION_RULES } from "./decoration"
import { COPY_RULES } from "./copy"
import { SOURCE_RULES } from "./source"

export const ALL_RULES: readonly Rule[] = [
	...COLOR_RULES,
	...TYPOGRAPHY_RULES,
	...LAYOUT_RULES,
	...DECORATION_RULES,
	...COPY_RULES,
	...SOURCE_RULES,
]
