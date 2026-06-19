import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
	findSgBinarySync,
	provisionSgBinary,
	runtimeSlug,
	SG_PINNED_VERSION,
	sgBinaryName,
	type SgFetch,
	type SgManifestAsset,
	type SgRuntimeSlug,
} from "../../../../../utils/src/ast-grep/index.ts";
import { appendBootstrapLog, BOOTSTRAP_DOCTOR_HINT } from "./worker.ts";
import type { BootstrapStepOutcome, BootstrapWorkerContext } from "./worker.ts";

export const SG_PROVISION_COMPONENT = "ast_grep";
export const SG_FORCE_PROVISION_ENV_KEY = "OMO_BOOTSTRAP_FORCE_PROVISION";

export interface ResolvePreexistingSgOptions {
	readonly arch: string;
	readonly codexHome: string;
	readonly env: Record<string, string | undefined>;
	readonly platform: NodeJS.Platform;
}

export interface SgProvisionSeams {
	readonly arch?: string;
	readonly fetchImpl?: SgFetch;
	readonly releaseAssets?: Partial<Record<SgRuntimeSlug, SgManifestAsset>>;
	readonly resolvePreexistingSg?: (options: ResolvePreexistingSgOptions) => string | null;
	readonly runVersionProbe?: (binaryPath: string) => Promise<string>;
}

export function sgProvisionDestination(context: BootstrapWorkerContext, arch: string): string {
	return join(sgRuntimeDir(context.codexHome, context.platform, arch), sgBinaryName(context.platform));
}

function sgRuntimeDir(codexHome: string, platform: NodeJS.Platform, arch: string): string {
	return join(codexHome, "runtime", "ast-grep", runtimeSlug(platform, arch));
}

export async function runSgProvision(
	context: BootstrapWorkerContext,
	seams: SgProvisionSeams = {},
): Promise<BootstrapStepOutcome> {
	const arch = seams.arch ?? process.arch;
	const destination = sgProvisionDestination(context, arch);

	if (context.env[SG_FORCE_PROVISION_ENV_KEY] !== "1") {
		const preexisting = (seams.resolvePreexistingSg ?? defaultResolvePreexistingSg)({
			arch,
			codexHome: context.codexHome,
			env: context.env,
			platform: context.platform,
		});
		if (preexisting !== null) {
			await appendBootstrapLog(context.pluginData, context.now, "sg-provision", { sg: `preexisting:${preexisting}` });
			return { degraded: [] };
		}
	}

	try {
		const version = await provisionFromSharedManifest(context, seams, { arch, destination });
		await appendBootstrapLog(context.pluginData, context.now, "sg-provision", {
			sg: `provisioned:${destination}`,
			version,
		});
		return { degraded: [] };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		await appendBootstrapLog(context.pluginData, context.now, "sg-provision-failed", { reason });
		return { degraded: [{ component: SG_PROVISION_COMPONENT, hint: BOOTSTRAP_DOCTOR_HINT, reason }] };
	}
}

async function provisionFromSharedManifest(
	context: BootstrapWorkerContext,
	seams: SgProvisionSeams,
	layout: { readonly arch: string; readonly destination: string },
): Promise<string> {
	const provisionedPath = await provisionSgBinary({
		arch: layout.arch,
		platform: context.platform,
		targetDir: dirname(layout.destination),
		...(seams.fetchImpl === undefined ? {} : { fetchImpl: seams.fetchImpl }),
		...(seams.releaseAssets === undefined ? {} : { releaseAssets: seams.releaseAssets }),
	});
	if (provisionedPath !== layout.destination) {
		await rm(provisionedPath, { force: true });
		throw new Error(`provisioned sg at ${provisionedPath} but expected ${layout.destination}; removed the binary.`);
	}
	await verifyProvisionedVersion(layout.destination, SG_PINNED_VERSION, seams);
	return SG_PINNED_VERSION;
}

async function verifyProvisionedVersion(
	destination: string,
	pinnedVersion: string,
	seams: SgProvisionSeams,
): Promise<void> {
	let reported: string;
	try {
		reported = (await (seams.runVersionProbe ?? defaultVersionProbe)(destination)).trim();
	} catch (error) {
		await rm(destination, { force: true });
		throw new Error(
			`provisioned sg at ${destination} failed its --version probe: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!reported.includes(pinnedVersion)) {
		await rm(destination, { force: true });
		throw new Error(
			`provisioned sg at ${destination} reported "${reported}" but the manifest pins version ${pinnedVersion}; removed the binary.`,
		);
	}
}

function defaultResolvePreexistingSg(options: ResolvePreexistingSgOptions): string | null {
	return findSgBinarySync({
		arch: options.arch,
		env: { ...options.env, CODEX_HOME: options.codexHome },
		platform: options.platform,
		runtimeDir: sgRuntimeDir(options.codexHome, options.platform, options.arch),
	});
}

const execFileAsync = promisify(execFile);

async function defaultVersionProbe(binaryPath: string): Promise<string> {
	const { stdout } = await execFileAsync(binaryPath, ["--version"]);
	return String(stdout);
}
