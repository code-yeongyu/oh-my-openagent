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
			return "Grant Screen Recording and Accessibility to the app that launched senpi, then restart it.";
		case "COMPUTER_PERMISSION_DENIED":
			return "A permission rule denied this action; do not retry it.";
		case "COMPUTER_CURSOR_RESTORE_FAILED":
		case "COMPUTER_FOCUS_RESTORE_FAILED":
			return "Input may have completed, but the previous state was not restored. Ask the user to inspect the desktop before retrying.";
		case "COMPUTER_BACKGROUND_UNAVAILABLE":
			return "This window cannot take background input; use the computer tool's accessibility actions instead.";
		default:
			return undefined;
	}
}

export interface ComputerFailure {
	readonly code: string;
	readonly message: string;
}

export function computerFailure(code: string, reason: string, stopHotkey: string): ComputerFailure {
	const mapped = code.startsWith("COMPUTER_") ? code : (ENGINE_TO_COMPUTER[code] ?? "COMPUTER_ERROR");
	const recovery = hint(mapped, stopHotkey);
	return { code: mapped, message: `${mapped}: ${reason}${recovery === undefined ? "" : ` ${recovery}`}` };
}
