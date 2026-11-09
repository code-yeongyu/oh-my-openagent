import type { Rule } from "../../rule"
import { allCapsBody } from "./all-caps-body"
import { designSystemFont } from "./design-system-font"
import { designSystemFontSize } from "./design-system-font-size"
import { extremeNegativeTracking } from "./extreme-negative-tracking"
import { flatTypeHierarchy } from "./flat-type-hierarchy"
import { italicSerifDisplay } from "./italic-serif-display"
import { justifiedText } from "./justified-text"
import { lineLength } from "./line-length"
import { oversizedH1 } from "./oversized-h1"
import { overusedFont } from "./overused-font"
import { tightLeading } from "./tight-leading"
import { tinyText } from "./tiny-text"
import { undersizedUiText } from "./undersized-ui-text"
import { wideTracking } from "./wide-tracking"

export const TYPOGRAPHY_RULES: readonly Rule[] = [
	overusedFont, flatTypeHierarchy, italicSerifDisplay, oversizedH1, extremeNegativeTracking,
	tinyText, undersizedUiText, allCapsBody, wideTracking, tightLeading, justifiedText,
	lineLength, designSystemFont, designSystemFontSize,
]
