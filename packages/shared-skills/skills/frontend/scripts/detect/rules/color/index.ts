import type { PageRule } from "../../rule"
import { aiColorPalette } from "./ai-color-palette"
import { creamPalette } from "./cream-palette"
import { darkGlow } from "./dark-glow"
import { designSystemColor } from "./design-system-color"
import { gradientText } from "./gradient-text"
import { grayOnColor } from "./gray-on-color"
import { lowContrast } from "./low-contrast"
import { radialHalo } from "./radial-halo"
import { radialSpotlightGlow } from "./radial-spotlight-glow"

export const COLOR_RULES: readonly PageRule[] = [
	lowContrast, grayOnColor, aiColorPalette, creamPalette, gradientText,
	darkGlow, radialHalo, radialSpotlightGlow, designSystemColor,
]
