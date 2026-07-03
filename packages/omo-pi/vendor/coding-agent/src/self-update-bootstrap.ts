import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	APP_NAME,
	getAgentDir,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	PACKAGE_NAME,
	VERSION,
} from "./config.ts";
import { getLatestPiRelease, isNewerPackageVersion, type LatestPiRelease } from "./utils/version-check.ts";

export interface SelfUpdateBootstrapCommand {
	command: string;
	args: string[];
	display: string;
	steps?: SelfUpdateBootstrapCommand[];
}

interface BootstrapSelfUpdateArgs {
	force: boolean;
}

interface BootstrapSelfUpdateDependencies {
	getLatestRelease?: (currentVersion: string) => Promise<LatestPiRelease | undefined>;
	getSelfUpdateCommand?: (
		packageName: string,
		npmCommand?: string[],
		updatePackageName?: string,
	) => SelfUpdateBootstrapCommand | undefined;
	getUnavailableInstruction?: (packageName: string, npmCommand?: string[], updatePackageName?: string) => string;
	readNpmCommand?: () => string[] | undefined;
	runCommand?: (step: SelfUpdateBootstrapCommand) => Promise<void>;
	writeStdout?: (line: string) => void;
	writeStderr?: (line: string) => void;
}

function parseBootstrapSelfUpdateArgs(args: readonly string[]): BootstrapSelfUpdateArgs | undefined {
	const [command, ...rest] = args;
	if (command !== "update") {
		return undefined;
	}

	let force = false;
	let selfFlag = false;
	let extensionsFlag = false;
	let extensionFlag = false;
	let source: string | undefined;

	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "-h" || arg === "--help") {
			return undefined;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg === "--self") {
			selfFlag = true;
			continue;
		}
		if (arg === "--extensions") {
			extensionsFlag = true;
			continue;
		}
		if (arg === "--extension") {
			extensionFlag = true;
			index++;
			continue;
		}
		if (arg.startsWith("-")) {
			return undefined;
		}
		if (source) {
			return undefined;
		}
		source = arg;
	}

	if (extensionFlag) {
		return undefined;
	}

	const sourceIsSelf = source === "self" || source === "pi" || source === APP_NAME;
	if (source && !sourceIsSelf) {
		return undefined;
	}

	if (!selfFlag && !sourceIsSelf && extensionsFlag) {
		return undefined;
	}

	return { force };
}

function getObjectProperty(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function readConfiguredNpmCommand(): string[] | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf-8"));
		const npmCommand = getObjectProperty(parsed, "npmCommand");
		if (!Array.isArray(npmCommand) || npmCommand.some((part) => typeof part !== "string")) {
			return undefined;
		}
		return npmCommand.length > 0 ? npmCommand : undefined;
	} catch {
		return undefined;
	}
}

async function runCommand(step: SelfUpdateBootstrapCommand): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(step.command, step.args, { stdio: "inherit" });
		child.on("error", (error) => {
			reject(error);
		});
		child.on("close", (code, signal) => {
			if (code === 0) {
				resolve();
			} else if (signal) {
				reject(new Error(`${step.display} terminated by signal ${signal}`));
			} else {
				reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
			}
		});
	});
}

export async function handleBootstrapSelfUpdate(
	args: readonly string[],
	dependencies: BootstrapSelfUpdateDependencies = {},
): Promise<boolean> {
	const parsed = parseBootstrapSelfUpdateArgs(args);
	if (!parsed) {
		return false;
	}

	const writeStdout = dependencies.writeStdout ?? ((line: string) => console.log(line));
	const writeStderr = dependencies.writeStderr ?? ((line: string) => console.error(line));
	const readNpmCommand = dependencies.readNpmCommand ?? readConfiguredNpmCommand;
	const resolveSelfUpdateCommand = dependencies.getSelfUpdateCommand ?? getSelfUpdateCommand;
	const resolveUnavailableInstruction = dependencies.getUnavailableInstruction ?? getSelfUpdateUnavailableInstruction;
	const executeCommand = dependencies.runCommand ?? runCommand;
	const loadLatestRelease = dependencies.getLatestRelease ?? getLatestPiRelease;

	let latestRelease: LatestPiRelease | undefined;
	if (!parsed.force) {
		try {
			latestRelease = await loadLatestRelease(VERSION);
		} catch {
			latestRelease = undefined;
		}
	}

	const updatePackageName = latestRelease?.packageName ?? PACKAGE_NAME;
	const shouldRun =
		parsed.force ||
		!latestRelease ||
		updatePackageName !== PACKAGE_NAME ||
		isNewerPackageVersion(latestRelease.version, VERSION);

	if (!shouldRun) {
		writeStdout(`${APP_NAME} is already up to date (v${VERSION})`);
		return true;
	}

	const npmCommand = readNpmCommand();
	const selfUpdateCommand = resolveSelfUpdateCommand(PACKAGE_NAME, npmCommand, updatePackageName);
	if (!selfUpdateCommand) {
		writeStderr(`error: ${APP_NAME} cannot self-update this installation.`);
		writeStderr(resolveUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageName));
		if (process.argv[1]) {
			writeStderr("");
			writeStderr(`Location of ${APP_NAME} executable: ${process.argv[1]}`);
		}
		process.exitCode = 1;
		return true;
	}

	if (latestRelease?.note?.trim()) {
		writeStdout("");
		writeStdout("Update note");
		writeStdout(latestRelease.note.trim());
		writeStdout("");
	}

	writeStdout(`Updating ${APP_NAME} with ${selfUpdateCommand.display}...`);
	for (const step of selfUpdateCommand.steps ?? [selfUpdateCommand]) {
		try {
			await executeCommand(step);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown package command error";
			writeStderr(`Error: ${message}`);
			writeStderr(`If this keeps failing, run this command yourself: ${selfUpdateCommand.display}`);
			process.exitCode = 1;
			return true;
		}
	}
	writeStdout(`Updated ${APP_NAME}`);
	return true;
}
