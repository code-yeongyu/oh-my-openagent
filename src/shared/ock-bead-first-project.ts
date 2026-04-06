import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { findProjectOpencodeCommandDirs } from "./project-discovery-dirs";

const REQUIRED_COMMAND = "create.md";
const OPTIONAL_WORKFLOW_COMMANDS = [
	"research.md",
	"start.md",
	"plan.md",
	"ship.md",
	"pr.md",
];

function getProjectRoot(commandDirectory: string): string {
	return dirname(dirname(commandDirectory));
}

function detectScanBoundary(startDirectory: string): string | undefined {
	let currentDirectory = startDirectory;

	while (true) {
		if (existsSync(join(currentDirectory, ".git"))) {
			return currentDirectory;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			return undefined;
		}

		currentDirectory = parentDirectory;
	}
}

function hasCanonicalOckWorkflowCommands(
	commandDirectories: string[],
): boolean {
	const presentCommands = new Set<string>();

	for (const commandDirectory of commandDirectories) {
		if (existsSync(join(commandDirectory, REQUIRED_COMMAND))) {
			presentCommands.add(REQUIRED_COMMAND);
		}

		for (const commandName of OPTIONAL_WORKFLOW_COMMANDS) {
			if (existsSync(join(commandDirectory, commandName))) {
				presentCommands.add(commandName);
			}
		}
	}

	const optionalCommandCount = OPTIONAL_WORKFLOW_COMMANDS.filter(
		(commandName) => presentCommands.has(commandName),
	).length;

	return presentCommands.has(REQUIRED_COMMAND) && optionalCommandCount >= 3;
}

export function isOckBeadFirstProject(startDirectory: string): boolean {
	const scanBoundary = detectScanBoundary(startDirectory);
	if (!scanBoundary) {
		return false;
	}

	const commandDirectories = findProjectOpencodeCommandDirs(
		startDirectory,
		scanBoundary,
	);
	const projectRoots = new Set(commandDirectories.map(getProjectRoot));

	for (const projectRoot of projectRoots) {
		const projectCommandDirectories = commandDirectories.filter(
			(commandDirectory) => getProjectRoot(commandDirectory) === projectRoot,
		);

		if (!existsSync(join(projectRoot, ".beads"))) {
			continue;
		}

		if (hasCanonicalOckWorkflowCommands(projectCommandDirectories)) {
			return true;
		}
	}

	return false;
}
