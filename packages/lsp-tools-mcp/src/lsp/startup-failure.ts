import { LspProcessExitedError } from "./errors.js";

const RUST_SRC_REPAIR_MESSAGE = [
	"rust-analyzer exited while loading Rust standard library sources.",
	"",
	"Repair rust-src for the active toolchain:",
	"  rustup component remove rust-src",
	"  rustup component add rust-src",
];

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function formatKnownLspStartupFailure(error: unknown): string | null {
	if (!(error instanceof LspProcessExitedError)) return null;
	if (error.serverId !== "rust") return null;

	const details = error.stderrTail ?? error.message;
	const lowerDetails = details.toLowerCase();
	const isRustSrcFailure =
		lowerDetails.includes("rust-src") &&
		(lowerDetails.includes("failed to install component") ||
			lowerDetails.includes("detected conflict") ||
			lowerDetails.includes("can't load standard library") ||
			lowerDetails.includes("try installing") ||
			lowerDetails.includes("sysroot"));

	if (!isRustSrcFailure) return null;

	return [...RUST_SRC_REPAIR_MESSAGE, "", "Original stderr tail:", details].join("\n");
}

export function handleMissingDependencyError(error: unknown): string | null {
	const knownStartupFailure = formatKnownLspStartupFailure(error);
	if (knownStartupFailure) return knownStartupFailure;

	const message = errorMessage(error);
	return message.includes("NOT INSTALLED") || message.includes("No LSP server configured") ? message : null;
}
