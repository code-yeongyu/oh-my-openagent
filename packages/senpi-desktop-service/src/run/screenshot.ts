import type { RunScope } from "./context";
import { type CaptureRegion, type CaptureResult, expectResult, isCaptureResult, isZoomResult } from "./engine-results";

export interface ScreenshotOptions {
	/** Skip displaying the capture to the model. */
	readonly silent?: boolean;
	/** A zoom must use this full frame when supplied; stale ids are refused. */
	readonly frameId?: string;
}

/** What `screenshot()` returns to user code; `x`/`y` of later input are pixels of this frame. */
export interface ScreenshotResult {
	readonly target: string;
	readonly frameId: string;
	readonly width: number;
	readonly height: number;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly coordinateWidth: number;
	readonly coordinateHeight: number;
	/** Zoom pixels are not input coordinates; pointer input stays in the full frame. */
	readonly region?: CaptureRegion;
	readonly scale: number;
	/** Full-resolution artifact, when the engine wrote one. */
	readonly path?: string;
}

function caption(frame: CaptureResult): string {
	const size = `${frame.width}x${frame.height}`;
	const scaled = frame.width !== frame.sourceWidth || frame.height !== frame.sourceHeight;
	const source = scaled ? ` (scaled from ${frame.sourceWidth}x${frame.sourceHeight})` : "";
	const artifact = frame.artifactPath ? ` -> ${frame.artifactPath}` : "";
	const zoom = frame.region == null ? "" :
		` zoom; input coordinates remain ${frame.coordinateWidth ?? frame.width}x${frame.coordinateHeight ?? frame.height}`;
	return `screenshot ${frame.target} ${size}${source}${artifact}${zoom}`;
}

/**
 * `capture` under the snapshot's caps; the engine owns the byte budget and the coordinate frame.
 * An inline capture is displayed as an image, an artifact-only one as the engine's note and path.
 */
export async function captureScreenshot(
	scope: RunScope,
	target: string,
	options: ScreenshotOptions = {},
	region?: CaptureRegion,
): Promise<ScreenshotResult> {
	const { snapshot } = scope.context;
	const caps = {
		maxWidth: snapshot.captureMaxWidth,
		maxHeight: snapshot.captureMaxHeight,
		maxBytes: snapshot.captureMaxBytes,
	};
	const method = region === undefined ? "capture" : "captureRegion";
	const params = region === undefined ? { target, caps } : { target, caps, region, frameId: options.frameId };
	const frame = expectResult(method, await scope.call(method, params), region === undefined ? isCaptureResult : isZoomResult);
	return displayScreenshot(scope, frame, options);
}

/** Displays and projects a capture already obtained by screenshot or observe. */
export function displayScreenshot(
	scope: RunScope,
	frame: CaptureResult,
	options: ScreenshotOptions = {},
): ScreenshotResult {
	const { output, screenshots } = scope.context;
	const path = frame.artifactPath ?? undefined;
	if (path !== undefined) {
		screenshots.push({
			path,
			width: frame.width,
			height: frame.height,
			sourceWidth: frame.sourceWidth,
			sourceHeight: frame.sourceHeight,
			target: frame.target,
		});
	}
	if (options.silent !== true) {
		output.text(caption(frame));
		if (frame.mode !== "artifact-only" && frame.data && frame.mimeType) {
			output.image(frame.data, frame.mimeType);
		} else {
			output.text(frame.note ?? "screenshot is available only as the artifact above");
		}
	}
	const { width, height, sourceWidth, sourceHeight, scale, frameId } = frame;
	const coordinateWidth = frame.coordinateWidth ?? width;
	const coordinateHeight = frame.coordinateHeight ?? height;
	return {
		target: frame.target,
		frameId,
		width,
		height,
		sourceWidth,
		sourceHeight,
		coordinateWidth,
		coordinateHeight,
		...(frame.region == null ? {} : { region: frame.region }),
		scale,
		...(path === undefined ? {} : { path }),
	};
}
