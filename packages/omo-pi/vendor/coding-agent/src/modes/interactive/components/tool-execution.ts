import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Box, type Component, Container, getCapabilities, Image, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { ToolDefinition, ToolRenderContext } from "../../../core/extensions/types.ts";
import { createAllToolDefinitions, type ToolName } from "../../../core/tools/index.ts";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { convertToPng } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";
import { createBoundedRenderSignature } from "./render-signature.ts";

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
}

type ToolExecutionResult = Omit<AgentToolResult<unknown>, "details"> & {
	details?: unknown;
	isError: boolean;
};

const FALLBACK_STRING_MAX_LENGTH = 160;
const FALLBACK_JSON_MAX_LENGTH = 2000;
const PENDING_RENDER_FRAME_INTERVAL_MS = 80;

function sanitizeFallbackString(value: string, maxLength = FALLBACK_STRING_MAX_LENGTH): string {
	const sanitized = stripAnsi(value)
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (sanitized.length <= maxLength) {
		return sanitized;
	}
	return `${sanitized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sanitizeFallbackJsonValue(_key: string, value: unknown): unknown {
	if (typeof value === "string") {
		return sanitizeFallbackString(value);
	}
	return value;
}

export class ToolExecutionComponent extends Container {
	private cachedLines?: string[];
	private cachedSignature?: string;
	private cachedWidth?: number;
	private contentBox: Box;
	private contentText: Text;
	private selfRenderContainer: Container;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolDefinition<any, any>;
	private builtInToolDefinition?: ToolDefinition<any, any>;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private spinnerFrame?: number;
	private spinnerInterval?: NodeJS.Timeout;
	private result?: ToolExecutionResult;
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	private hideComponent = false;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolDefinition<any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.builtInToolDefinition = createAllToolDefinitions(cwd)[toolName as ToolName];
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		// Always create all shell variants. contentBox is used for default renderer-based composition.
		// selfRenderContainer is used when the tool renders its own framing.
		// contentText is reserved for generic fallback rendering when no tool definition exists.
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.selfRenderContainer = new Container();

		if (this.hasRendererDefinition()) {
			this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
		} else {
			this.addChild(this.contentText);
		}

		this.updateSpinnerAnimation();
		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderCall;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderCall;
		}
		return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderResult;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderResult;
		}
		return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderShell ?? "default";
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderShell ?? "default";
		}
		return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
			spinnerFrame: this.spinnerFrame,
		};
	}

	private createCallFallback(): Component {
		return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}
		return new Text(theme.fg("toolOutput", output), 0, 0);
	}

	updateArgs(args: any): void {
		this.args = args;
		this.lastDisplaySignature = undefined;
		this.updateSpinnerAnimation();
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateSpinnerAnimation();
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateSpinnerAnimation();
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(result: ToolExecutionResult, isPartial = false): void {
		this.result = result;
		this.isPartial = isPartial;
		if (!isPartial) {
			this.argsComplete = true;
		}
		this.lastDisplaySignature = undefined;
		this.updateSpinnerAnimation();
		this.updateDisplay();
		this.maybeConvertImagesForKitty();
	}

	stopAnimation(): void {
		this.stopSpinnerAnimation();
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((c) => c.type === "image");
		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		this.invalidateRenderCache();
		super.invalidate();
		this.lastDisplaySignature = undefined;
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}
		const signature = this.createRenderSignature();
		if (this.cachedLines && this.cachedWidth === width && this.cachedSignature === signature) {
			return [...this.cachedLines];
		}

		let lines: string[];
		if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			lines = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
		} else {
			lines = super.render(width);
		}

		this.cachedWidth = width;
		this.cachedSignature = signature;
		this.cachedLines = [...lines];
		return lines;
	}

	private lastDisplaySignature?: string;

	private updateDisplay(): void {
		const displaySignature = this.createRenderSignature();
		if (this.lastDisplaySignature === displaySignature) {
			return;
		}
		this.lastDisplaySignature = displaySignature;
		this.invalidateRenderCache();

		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		let hasContent = false;
		this.hideComponent = false;
		if (this.hasRendererDefinition()) {
			const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
			}
			renderContainer.detachAll();

			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				renderContainer.addChild(this.createCallFallback());
				hasContent = true;
			} else {
				try {
					const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
					this.callRendererComponent = component;
					renderContainer.addChild(component);
					hasContent = true;
				} catch {
					this.callRendererComponent = undefined;
					renderContainer.addChild(this.createCallFallback());
					hasContent = true;
				}
			}

			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					const component = this.createResultFallback();
					if (component) {
						renderContainer.addChild(component);
						hasContent = true;
					}
				} else {
					try {
						const agentToolResult = {
							content: this.result.content,
							details: this.result.details,
						} satisfies AgentToolResult<unknown>;
						const component = resultRenderer(
							agentToolResult,
							{ expanded: this.expanded, isPartial: this.isPartial },
							theme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = component;
						renderContainer.addChild(component);
						hasContent = true;
					} catch {
						this.resultRendererComponent = undefined;
						const component = this.createResultFallback();
						if (component) {
							renderContainer.addChild(component);
							hasContent = true;
						}
					}
				}
			}
		} else {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setText(this.formatToolExecution());
			hasContent = true;
		}

		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content.filter((c) => c.type === "image");
			const caps = getCapabilities();
			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (caps.images && this.showImages && img.data && img.mimeType) {
					const converted = this.convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;
					if (caps.images === "kitty" && imageMimeType !== "image/png") continue;

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: this.imageWidthCells },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	private formatToolExecution(): string {
		let text = theme.fg("toolTitle", theme.bold(sanitizeFallbackString(this.toolName)));
		const content = JSON.stringify(this.args, sanitizeFallbackJsonValue, 2);
		if (content) {
			const boundedContent =
				content.length > FALLBACK_JSON_MAX_LENGTH
					? `${content.slice(0, FALLBACK_JSON_MAX_LENGTH - 3)}...`
					: content;
			text += `\n\n${boundedContent}`;
		}
		const output = this.getTextOutput();
		if (output) {
			text += `\n${sanitizeFallbackString(output, FALLBACK_JSON_MAX_LENGTH)}`;
		}
		return text;
	}

	private createRenderSignature(): string {
		return createBoundedRenderSignature({
			args: this.args,
			argsComplete: this.argsComplete,
			executionStarted: this.executionStarted,
			expanded: this.expanded,
			hideComponent: this.hideComponent,
			imageWidthCells: this.imageWidthCells,
			isPartial: this.isPartial,
			result: this.result,
			showImages: this.showImages,
			spinnerFrame: this.spinnerFrame,
			toolCallId: this.toolCallId,
			toolName: this.toolName,
		});
	}

	private updateSpinnerAnimation(): void {
		const isStreamingArgs =
			!this.argsComplete &&
			(this.toolName === "edit" || this.toolName === "write" || this.toolName === "apply_patch");
		const isPartialTask = this.isPartial && this.toolName === "task" && this.result !== undefined;
		if (isStreamingArgs || isPartialTask) {
			this.startSpinnerAnimation();
			return;
		}
		this.stopSpinnerAnimation();
	}

	private startSpinnerAnimation(): void {
		if (this.spinnerInterval) {
			return;
		}
		this.spinnerInterval = setInterval(() => {
			this.spinnerFrame = ((this.spinnerFrame ?? -1) + 1) % 10;
			this.invalidateRenderCache();
			this.updateDisplay();
			this.ui.requestRender();
		}, PENDING_RENDER_FRAME_INTERVAL_MS);
		this.spinnerInterval.unref?.();
	}

	private stopSpinnerAnimation(): void {
		if (!this.spinnerInterval) {
			return;
		}
		clearInterval(this.spinnerInterval);
		this.spinnerInterval = undefined;
		this.spinnerFrame = undefined;
		this.invalidateRenderCache();
	}

	private invalidateRenderCache(): void {
		this.cachedLines = undefined;
		this.cachedSignature = undefined;
		this.cachedWidth = undefined;
	}
}
