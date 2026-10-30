import type { Rule } from "../../rule"
import { hardOffsetShadow } from "./hard-offset-shadow"
import { sideTab } from "./side-tab"
import { borderAccentOnRounded } from "./border-accent-on-rounded"
import { gptThinBorderWideShadow } from "./gpt-thin-border-wide-shadow"
import { repeatingStripesGradient } from "./repeating-stripes-gradient"
import { codexGridBackground } from "./codex-grid-background"
import { organicClipPath } from "./organic-clip-path"
import { buriedRaster } from "./buried-raster"
import { shapeAssembledIllustration } from "./shape-assembled-illustration"
import { iconTileStack } from "./icon-tile-stack"
import { heroEyebrowChip } from "./hero-eyebrow-chip"
import { kickerAboveHeading } from "./kicker-above-heading"
import { designSystemRadius } from "./design-system-radius"
import { marquee } from "./marquee"
import { pulsingDot } from "./pulsing-dot"
import { blinkingCursor } from "./blinking-cursor"
import { bounceEasing } from "./bounce-easing"

export const DECORATION_RULES: readonly Rule[] = [
	hardOffsetShadow,
	sideTab,
	borderAccentOnRounded,
	gptThinBorderWideShadow,
	repeatingStripesGradient,
	codexGridBackground,
	organicClipPath,
	buriedRaster,
	shapeAssembledIllustration,
	iconTileStack,
	heroEyebrowChip,
	kickerAboveHeading,
	designSystemRadius,
	marquee,
	pulsingDot,
	blinkingCursor,
	bounceEasing,
]
