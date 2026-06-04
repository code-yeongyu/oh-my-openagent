export interface DecodedImage {
	readonly width: number
	readonly height: number
	readonly rgba: Uint8Array
	readonly hasAlphaChannel: boolean
	readonly hasTransparentPixels: boolean
}

export interface Hotspot {
	readonly gridX: number
	readonly gridY: number
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
	readonly diffRatio: number
}

export interface ImageDimensions {
	readonly width: number
	readonly height: number
}

export interface ImageDiffResult {
	readonly command: "image-diff"
	readonly dimensionsMatch: boolean
	readonly reference: ImageDimensions
	readonly actual: ImageDimensions
	readonly totalPixels: number
	readonly diffPixels: number
	readonly diffRatio: number
	readonly similarityScore: number
	readonly alphaChannelIntact: boolean
	readonly hotspots: readonly Hotspot[]
	readonly summary: string
}

export interface OverflowLine {
	readonly line: number
	readonly width: number
}

export interface TuiCheckResult {
	readonly command: "tui-check"
	readonly expectedColumns: number
	readonly lineCount: number
	readonly lineWidths: readonly number[]
	readonly maxWidth: number
	readonly overflowLines: readonly OverflowLine[]
	readonly borderMisaligned: boolean
	readonly wideCharColumns: readonly number[]
	readonly hasAnsi: boolean
	readonly summary: string
}
