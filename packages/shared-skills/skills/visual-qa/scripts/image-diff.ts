import type { DecodedImage, Hotspot, ImageDiffResult } from "./types"

const GRID_SIZE = 8

function round4(value: number): number {
	return Math.round(value * 10000) / 10000
}

function pixelsDiffer(ref: Uint8Array, refOffset: number, act: Uint8Array, actOffset: number): boolean {
	return (
		ref[refOffset] !== act[actOffset] ||
		ref[refOffset + 1] !== act[actOffset + 1] ||
		ref[refOffset + 2] !== act[actOffset + 2] ||
		ref[refOffset + 3] !== act[actOffset + 3]
	)
}

function buildHotspots(
	cellDiff: readonly number[],
	cellTotal: readonly number[],
	cols: number,
	rows: number,
	overlapWidth: number,
	overlapHeight: number,
): Hotspot[] {
	const hotspots: Hotspot[] = []
	for (let gridY = 0; gridY < rows; gridY++) {
		for (let gridX = 0; gridX < cols; gridX++) {
			const index = gridY * cols + gridX
			const diff = cellDiff[index] ?? 0
			const total = cellTotal[index] ?? 0
			if (diff === 0 || total === 0) continue
			const left = Math.floor((gridX * overlapWidth) / cols)
			const right = Math.floor(((gridX + 1) * overlapWidth) / cols)
			const top = Math.floor((gridY * overlapHeight) / rows)
			const bottom = Math.floor(((gridY + 1) * overlapHeight) / rows)
			hotspots.push({
				gridX,
				gridY,
				x: left,
				y: top,
				width: right - left,
				height: bottom - top,
				diffRatio: round4(diff / total),
			})
		}
	}
	hotspots.sort((a, b) => b.diffRatio - a.diffRatio)
	return hotspots
}

function buildSummary(
	similarityScore: number,
	diffPixels: number,
	totalPixels: number,
	dimensionsMatch: boolean,
	hotspotCount: number,
): string {
	const parts = [`${similarityScore}/100 similarity`, `${diffPixels}/${totalPixels} pixels differ`]
	if (!dimensionsMatch) parts.push("dimensions differ")
	if (hotspotCount > 0) parts.push(`${hotspotCount} hotspot region(s)`)
	return `${parts.join("; ")}.`
}

export function diffImages(reference: DecodedImage, actual: DecodedImage): ImageDiffResult {
	const overlapWidth = Math.min(reference.width, actual.width)
	const overlapHeight = Math.min(reference.height, actual.height)
	const totalPixels = overlapWidth * overlapHeight
	const cols = Math.max(1, Math.min(GRID_SIZE, overlapWidth))
	const rows = Math.max(1, Math.min(GRID_SIZE, overlapHeight))
	const cellDiff = new Array<number>(cols * rows).fill(0)
	const cellTotal = new Array<number>(cols * rows).fill(0)

	let diffPixels = 0
	for (let y = 0; y < overlapHeight; y++) {
		const cellY = Math.min(rows - 1, Math.floor((y * rows) / overlapHeight))
		for (let x = 0; x < overlapWidth; x++) {
			const cellX = Math.min(cols - 1, Math.floor((x * cols) / overlapWidth))
			const cellIndex = cellY * cols + cellX
			cellTotal[cellIndex] = (cellTotal[cellIndex] ?? 0) + 1
			const refOffset = (y * reference.width + x) * 4
			const actOffset = (y * actual.width + x) * 4
			if (pixelsDiffer(reference.rgba, refOffset, actual.rgba, actOffset)) {
				diffPixels++
				cellDiff[cellIndex] = (cellDiff[cellIndex] ?? 0) + 1
			}
		}
	}

	const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels
	const similarityScore = Math.round((1 - diffRatio) * 100)
	const hotspots = buildHotspots(cellDiff, cellTotal, cols, rows, overlapWidth, overlapHeight)
	const dimensionsMatch = reference.width === actual.width && reference.height === actual.height
	const alphaChannelIntact = !(reference.hasTransparentPixels && !actual.hasTransparentPixels)

	return {
		command: "image-diff",
		dimensionsMatch,
		reference: { width: reference.width, height: reference.height },
		actual: { width: actual.width, height: actual.height },
		totalPixels,
		diffPixels,
		diffRatio: round4(diffRatio),
		similarityScore,
		alphaChannelIntact,
		hotspots,
		summary: buildSummary(similarityScore, diffPixels, totalPixels, dimensionsMatch, hotspots.length),
	}
}
