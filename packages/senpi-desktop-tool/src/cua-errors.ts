import type { PermissionDeniedData } from "@oh-my-opencode/senpi-desktop-protocol";
import type { DesktopLaunchContextError } from "@oh-my-opencode/senpi-desktop-service";

// Engine error codes and run failures as gajae-code's `COMPUTER_*` codes, each with its recovery hint.
const ENGINE_TO_COMPUTER: Readonly<Record<string, string>> = {
	Suspended: "COMPUTER_SUSPENDED",
	StopPathUnavailable: "COMPUTER_SUPERVISOR_NOT_LIVE",
	PermissionDenied: "COMPUTER_PERMISSION_REQUIRED",
	InvalidCoordinateFrame: "COMPUTER_DISPLAY_STALE",
	ScreenLocked: "COMPUTER_SCREEN_LOCKED",
	CaptureFailed: "COMPUTER_SCREENSHOT_FAILED",
	CursorRestoreFailed: "COMPUTER_CURSOR_RESTORE_FAILED",
	FocusRestoreFailed: "COMPUTER_FOCUS_RESTORE_FAILED",
	BackgroundUnavailable: "COMPUTER_BACKGROUND_UNAVAILABLE",
	ControlRequired: "COMPUTER_CONTROL_REQUIRED",
	InputBusy: "COMPUTER_INPUT_BUSY",
	UserIntervened: "COMPUTER_USER_INTERVENED",
	AxUnconfirmed: "COMPUTER_AX_UNCONFIRMED",
	SpaceUnsupported: "COMPUTER_SPACE_UNSUPPORTED",
	SpaceMoveDenied: "COMPUTER_SPACE_MOVE_DENIED",
	Cancelled: "COMPUTER_CANCELLED",
	Timeout: "COMPUTER_CANCELLED",
	timeout: "COMPUTER_CANCELLED",
	aborted: "COMPUTER_CANCELLED",
};

function hint(code: string, stopHotkey: string): string | undefined {
	const waitForUser = `Stop and wait for the user (stop chord: ${stopHotkey}); only the user resumes, with /computer resume.`;
	switch (code) {
		case "COMPUTER_COORD_INVALID":
			return "Capture a fresh screenshot and use coordinates within its frame.";
		case "COMPUTER_DISPLAY_STALE":
			return "Capture a fresh screenshot before acting; the display changed since the last screenshot.";
		case "COMPUTER_SUSPENDED":
		case "COMPUTER_SUPERVISOR_NOT_LIVE":
		case "COMPUTER_CANCELLED":
			return waitForUser;
		case "COMPUTER_PERMISSION_REQUIRED":
			return "Do not retry until the user says the grant is done and the app was relaunched.";
		case "COMPUTER_PERMISSION_DENIED":
			return "A permission rule denied this action; do not retry it.";
		case "COMPUTER_CURSOR_RESTORE_FAILED":
		case "COMPUTER_FOCUS_RESTORE_FAILED":
			return "Input may have completed, but the previous state was not restored. Ask the user to inspect the desktop before retrying.";
		case "COMPUTER_BACKGROUND_UNAVAILABLE":
			return "This window cannot take background input; use the computer tool's accessibility actions instead.";
		case "COMPUTER_CONTROL_REQUIRED":
			return "Call desktop.control.acquire({ reason }) in computer run code (computer.control.acquire in an eval kernel) and let the human confirm before acting in the foreground; do not retry this action until that returns { active: true }.";
		case "COMPUTER_INPUT_BUSY":
			return "Another session holds the foreground control grant; it is never stolen, so continue in the background or retry once that session releases it.";
		case "COMPUTER_USER_INTERVENED":
			return "The user is working in this window. Read the window again after the user pauses and decide from what it shows now; never repeat the action as it was.";
		case "COMPUTER_AX_UNCONFIRMED":
			return "The app did not confirm the accessibility request, so it may already have taken effect. Read the element or window back before any retry.";
		case "COMPUTER_SPACE_UNSUPPORTED":
			return "Moving windows between Spaces is not available here; ask the user to bring the window to the current Space.";
		case "COMPUTER_SPACE_MOVE_DENIED":
			return "The window could not be moved to the current Space; ask the user to bring it over, then read the window again.";
		default:
			return undefined;
	}
}

export interface ComputerFailure {
	readonly code: string;
	readonly message: string;
	readonly permission?: PermissionDeniedData["permission"];
	readonly settingsUrl?: string;
	readonly app?: string;
	readonly relaunchRequired?: boolean;
	readonly reason?: DesktopLaunchContextError["reason"];
}

export function launchContextFailure(error: DesktopLaunchContextError): ComputerFailure {
	return { code: "COMPUTER_LAUNCH_CONTEXT_REQUIRED", message: error.message, reason: error.reason };
}

export function computerFailure(
	code: string,
	reason: string,
	stopHotkey: string,
	permission?: PermissionDeniedData | null,
): ComputerFailure {
	const mapped = code.startsWith("COMPUTER_") ? code : (ENGINE_TO_COMPUTER[code] ?? "COMPUTER_ERROR");
	const recovery = hint(mapped, stopHotkey);
	return {
		code: mapped,
		message: `${mapped}: ${reason}${recovery === undefined ? "" : ` ${recovery}`}`,
		...(permission ?? {}),
	};
}
