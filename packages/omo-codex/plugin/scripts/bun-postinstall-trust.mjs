import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const LAZYCODEX_BUN_TRUST_PACKAGES = [
	"oh-my-openagent",
	"oh-my-opencode",
	"@ast-grep/cli",
	"@ast-grep/napi",
	"@code-yeongyu/comment-checker",
];

export function resolveBunGlobalUpdateInvocation(env = process.env) {
	const packageRoot = env.OMO_WRAPPER_PACKAGE_ROOT;
	if (typeof packageRoot !== "string" || !isBunGlobalPackageRoot(packageRoot))
		return null;
	return { command: "bun", args: ["add", "-g", "oh-my-openagent@latest"] };
}

export function parseBunUntrustedPackages(output) {
	const packages = [];
	for (const line of output.split(/\r?\n/)) {
		if (!line.startsWith("./node_modules/")) continue;
		const versionSeparator = line.lastIndexOf(" @");
		if (versionSeparator === -1) continue;
		packages.push(line.slice("./node_modules/".length, versionSeparator));
	}
	return packages;
}

export function filterLazyCodexTrustPackages(packages) {
	const available = new Set(packages);
	return LAZYCODEX_BUN_TRUST_PACKAGES.filter((packageName) =>
		available.has(packageName),
	);
}

export function formatBunTrustCommand(packages) {
	return ["bun", "pm", "-g", "trust", ...packages].join(" ");
}

export async function maybeTrustBunPostinstallScripts({
	command,
	args,
	env = process.env,
	log = console.log,
	runCommand = runBunTrustCommand,
	confirm,
	readUntrustedPackages = readBunGlobalUntrustedPackages,
	stdin = process.stdin,
	stdout = process.stdout,
} = {}) {
	if (!isBunGlobalUpdateCommand(command, args)) return { kind: "skipped" };

	const untrustedPackages = readUntrustedPackages(env);
	const trustPackages = filterLazyCodexTrustPackages(untrustedPackages);
	if (trustPackages.length === 0) return { kind: "none" };

	const commandText = formatBunTrustCommand(trustPackages);
	const approved =
		confirm === undefined
			? await promptForBunTrust({ commandText, stdin, stdout })
			: await confirm({ commandText, packages: trustPackages });

	if (!approved) {
		log(
			`Skipped Bun postinstall trust. To run the blocked LazyCodex scripts later: ${commandText}`,
		);
		return { kind: "declined", packages: trustPackages };
	}

	await runCommand("bun", ["pm", "-g", "trust", ...trustPackages], {
		cwd: process.cwd(),
		env,
	});
	log(`Ran Bun postinstall trust for ${trustPackages.join(", ")}.`);
	return { kind: "trusted", packages: trustPackages };
}

function isBunGlobalPackageRoot(packageRoot) {
	return packageRoot
		.replaceAll("\\", "/")
		.includes("/.bun/install/global/node_modules/");
}

function isBunGlobalUpdateCommand(command, args) {
	if (command !== "bun" || !Array.isArray(args)) return false;
	const hasGlobalFlag = args.includes("-g") || args.includes("--global");
	return (
		hasGlobalFlag &&
		args.includes("add") &&
		args.some(
			(arg) =>
				arg === "oh-my-openagent@latest" || arg === "lazycodex-ai@latest",
		)
	);
}

function readBunGlobalUntrustedPackages(env) {
	const result = spawnSync("bun", ["pm", "-g", "untrusted"], {
		encoding: "utf8",
		env,
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0 || typeof result.stdout !== "string") return [];
	return parseBunUntrustedPackages(result.stdout);
}

function runBunTrustCommand(command, args, options) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.status ?? "unknown status"}`,
		);
	}
}

async function promptForBunTrust({ commandText, stdin, stdout }) {
	if (!stdin.isTTY || !stdout.isTTY) {
		stdout.write(
			`Bun blocked LazyCodex postinstall scripts. To run them manually: ${commandText}\n`,
		);
		return false;
	}
	const readline = createInterface({ input: stdin, output: stdout });
	try {
		const answer = await readline.question(
			`Bun blocked LazyCodex postinstall scripts. Run ${commandText}? [y/N] `,
		);
		return /^(y|yes)$/i.test(answer.trim());
	} finally {
		readline.close();
	}
}
