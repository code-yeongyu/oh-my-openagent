import type { PageRule } from "../../rule"
import { aphoristicCadence } from "./aphoristic-cadence"
import { brokenImage } from "./broken-image"
import { emDashOveruse } from "./em-dash-overuse"
import { marketingBuzzword } from "./marketing-buzzword"
import { numberedSectionLabels } from "./numbered-section-labels"
import { repeatedContainerText } from "./repeated-container-text"
import { scriptError } from "./script-error"
import { skippedHeading } from "./skipped-heading"
import { theaterSlopPhrase } from "./theater-slop-phrase"

export const COPY_RULES: readonly PageRule[] = [
	emDashOveruse, marketingBuzzword, aphoristicCadence, theaterSlopPhrase, numberedSectionLabels,
	repeatedContainerText, skippedHeading, brokenImage, scriptError,
]
