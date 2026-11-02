import type { AuditRecord } from "./audit";
import type { DesktopCapabilities } from "./wire";

/** Frozen run settings the host hands to the desktop runtime for one `computer` run. */
export interface ComputerSessionSnapshot {
	readonly cwd: string;
	readonly sessionId: string;
	readonly captureMaxWidth: number;
	readonly captureMaxHeight: number;
	readonly captureMaxBytes: number;
	readonly display: string;
	readonly readOnly: boolean;
	readonly stopHotkey: string;
	readonly allowHostRelayOnlyStop: boolean;
}

/** Text shown to the model; structurally compatible with the ai package's `TextContent`. */
export interface ComputerTextDisplay {
	readonly type: "text";
	readonly text: string;
}

/** Base64 image shown to the model; structurally compatible with the ai package's `ImageContent`. */
export interface ComputerImageDisplay {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

export type ComputerDisplay = ComputerTextDisplay | ComputerImageDisplay;

/** Full-resolution screenshot artifact written during one computer run. */
export interface ComputerScreenshot {
	readonly path: string;
	readonly width: number;
	readonly height: number;
	readonly sourceWidth?: number;
	readonly sourceHeight?: number;
	readonly target: string;
}

/** Successful computer run output returned to the tool. */
export interface ComputerRunOk {
	readonly displays: readonly ComputerDisplay[];
	readonly returnValue: unknown;
	readonly screenshots: readonly ComputerScreenshot[];
	readonly capabilities?: DesktopCapabilities;
	readonly audit: readonly AuditRecord[];
}
