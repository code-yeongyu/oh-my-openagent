import type { TUI } from "../tui.ts";
import { Text } from "./text.ts";

export type LoaderMessageFormatter = (message: string, animationElapsedMs: number) => string;
export type LoaderIndicatorFormatter = (frame: string, animationElapsedMs: number) => string;

export interface LoaderIndicatorOptions {
	/** Animation frames. Use an empty array to hide the indicator. */
	frames?: string[];
	/** Frame interval in milliseconds for animated indicators. */
	intervalMs?: number;
	/** Optional indicator formatter called on each message animation frame. */
	indicatorFormatter?: LoaderIndicatorFormatter;
	/** Optional message formatter called on each message animation frame. */
	messageFormatter?: LoaderMessageFormatter;
	/** Frame interval in milliseconds for message animation. Defaults to intervalMs. */
	messageIntervalMs?: number;
}

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;

/**
 * Loader component that updates with an optional spinning animation.
 */
export class Loader extends Text {
	private frames = [...DEFAULT_FRAMES];
	private intervalMs = DEFAULT_INTERVAL_MS;
	private currentFrame = 0;
	private indicatorIntervalId: NodeJS.Timeout | null = null;
	private messageIntervalId: NodeJS.Timeout | null = null;
	private indicatorFormatter: LoaderIndicatorFormatter | undefined = undefined;
	private messageFormatter: LoaderMessageFormatter | undefined = undefined;
	private messageIntervalMs = DEFAULT_INTERVAL_MS;
	private messageAnimationStartedAt = 0;
	private ui: TUI | null = null;
	private renderIndicatorVerbatim = false;
	private spinnerColorFn: (str: string) => string;
	private messageColorFn: (str: string) => string;
	private message: string = "Loading...";
	private lastDisplayedText: string | undefined = undefined;

	constructor(
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string = "Loading...",
		indicator?: LoaderIndicatorOptions,
	) {
		super("", 1, 0);
		this.ui = ui;
		this.spinnerColorFn = spinnerColorFn;
		this.messageColorFn = messageColorFn;
		this.message = message;
		this.setIndicator(indicator);
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start(): void {
		if (this.messageFormatter) {
			this.messageAnimationStartedAt = Date.now();
		}
		this.updateDisplay();
		this.restartAnimation();
	}

	stop(): void {
		if (this.indicatorIntervalId) {
			clearInterval(this.indicatorIntervalId);
			this.indicatorIntervalId = null;
		}
		if (this.messageIntervalId) {
			clearInterval(this.messageIntervalId);
			this.messageIntervalId = null;
		}
	}

	dispose(): void {
		this.stop();
	}

	setMessage(message: string): void {
		this.message = message;
		this.updateDisplay();
	}

	setIndicator(indicator?: LoaderIndicatorOptions): void {
		this.renderIndicatorVerbatim = indicator !== undefined;
		this.frames = indicator?.frames !== undefined ? [...indicator.frames] : [...DEFAULT_FRAMES];
		this.intervalMs = indicator?.intervalMs && indicator.intervalMs > 0 ? indicator.intervalMs : DEFAULT_INTERVAL_MS;
		this.indicatorFormatter = indicator?.indicatorFormatter;
		this.messageFormatter = indicator?.messageFormatter;
		this.messageIntervalMs =
			indicator?.messageIntervalMs && indicator.messageIntervalMs > 0
				? indicator.messageIntervalMs
				: this.intervalMs;
		this.currentFrame = 0;
		this.messageAnimationStartedAt = Date.now();
		this.start();
	}

	private restartAnimation(): void {
		this.stop();
		if (this.frames.length > 1) {
			this.indicatorIntervalId = setInterval(() => {
				this.currentFrame = (this.currentFrame + 1) % this.frames.length;
				this.updateDisplay();
			}, this.intervalMs);
			this.indicatorIntervalId.unref?.();
		}
		if (this.indicatorFormatter || this.messageFormatter) {
			this.messageAnimationStartedAt = Date.now();
			this.messageIntervalId = setInterval(() => {
				this.updateDisplay();
			}, this.messageIntervalMs);
			this.messageIntervalId.unref?.();
		}
	}

	private updateDisplay(): void {
		const frame = this.frames[this.currentFrame] ?? "";
		const animationElapsedMs = Math.max(0, Date.now() - this.messageAnimationStartedAt);
		const renderedFrame = this.indicatorFormatter
			? this.indicatorFormatter(frame, animationElapsedMs)
			: this.renderIndicatorVerbatim
				? frame
				: this.spinnerColorFn(frame);
		const indicator = frame.length > 0 ? `${renderedFrame} ` : "";
		const renderedMessage = this.messageFormatter
			? this.messageFormatter(this.message, animationElapsedMs)
			: this.messageColorFn(this.message);
		const displayedText = `${indicator}${renderedMessage}`;
		if (displayedText === this.lastDisplayedText) {
			return;
		}
		this.lastDisplayedText = displayedText;
		this.setText(displayedText);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
