import type { RunScope } from "./context";
import { type CaptureResult, expectResult, isCaptureResult } from "./engine-results";

export interface ScreenshotOptions {
	/** Skip displaying the capture to the model. */
	readonly silent?: boolean;
}

/** What `screenshot()` returns to user code; `x`/`y` of later input are pixels of this frame. */
export interface ScreenshotResult {
	readonly target: string;
	readonly frameId: string;
	readonly width: number;
	readonly height: number;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly scale: number;
	/** Full-resolution artifact, when the engine wrote one. */
	readonly path?: string;
}

function caption(frame: CaptureResult): string {
	const size = `${frame.width}x${frame.height}`;
	const scaled = frame.width !== frame.sourceWidth || frame.height !== frame.sourceHeight;
	const source = scaled ? ` (scaled from ${frame.sourceWidth}x${frame.sourceHeight})` : "";
	const artifact = frame.artifactPath ? ` -> ${frame.artifactPath}` : "";
	return `screenshot ${frame.target} ${size}${source}${artifact}`;
}

/**
 * `capture` under the snapshot's caps; the engine owns the byte budget and the coordinate frame.
 * An inline capture is displayed as an image, an artifact-only one as the engine's note and path.
 */
export async function captureScreenshot(
	scope: RunScope,
	target: string,
	options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
	const { snapshot, output, screenshots } = scope.context;
	const caps = {
		maxWidth: snapshot.captureMaxWidth,
		maxHeight: snapshot.captureMaxHeight,
		maxBytes: snapshot.captureMaxBytes,
	};
	const frame = expectResult("capture", await scope.call("capture", { target, caps }), isCaptureResult);
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
	return {
		target: frame.target,
		frameId,
		width,
		height,
		sourceWidth,
		sourceHeight,
		scale,
		...(path === undefined ? {} : { path }),
	};
}
