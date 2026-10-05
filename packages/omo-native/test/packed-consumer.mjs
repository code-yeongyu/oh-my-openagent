import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDir = join(repoRoot, "packages/omo-native");
const driverPath = join(
	packageDir,
	"test/fixtures/senpi-hooks-state-consumer.mjs",
);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? repoRoot,
		env: options.env ?? process.env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: options.timeout ?? 120_000,
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed (${result.status ?? "signal"})\n${result.stdout}${result.stderr}`,
		);
	}
	return result.stdout;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function packageLockEntry(lock, packagePath) {
	const entry = lock.packages?.[packagePath];
	if (typeof entry !== "object" || entry === null)
		throw new Error(`Missing package-lock entry: ${packagePath}`);
	return entry;
}

async function main() {
	const packageManifest = readJson(join(packageDir, "package.json"));
	const expectedSenpiVersion =
		packageManifest.dependencies?.["@code-yeongyu/senpi"];
	if (typeof expectedSenpiVersion !== "string")
		throw new Error("omo-ai must pin @code-yeongyu/senpi");
	const expectedSenpiTarball = `https://registry.npmjs.org/@code-yeongyu/senpi/-/senpi-${expectedSenpiVersion}.tgz`;
	const root = await mkdtemp(join(tmpdir(), "omo-ai-packed-consumer-"));
	const packDir = join(root, "pack");
	const consumerDir = join(root, "consumer");
	const npmCache = join(root, "npm-cache");
	const cleanEnv = {
		...process.env,
		NODE_PATH: "",
		npm_config_cache: npmCache,
	};

	try {
		mkdirSync(packDir);
		mkdirSync(consumerDir);
		const packed = JSON.parse(
			run(
				"npm",
				[
					"pack",
					packageDir,
					"--json",
					"--ignore-scripts",
					"--pack-destination",
					packDir,
				],
				{ env: cleanEnv },
			),
		);
		const filename = packed[0]?.filename;
		if (typeof filename !== "string")
			throw new Error("npm pack did not return an omo-ai tarball");
		writeFileSync(
			join(root, "package.json"),
			`${JSON.stringify({ private: true })}\n`,
			"utf8",
		);
		writeFileSync(
			join(consumerDir, "package.json"),
			`${JSON.stringify({ name: "omo-ai-packed-consumer", private: true, type: "module" }, null, 2)}\n`,
			"utf8",
		);

		const tarballPath = join(packDir, filename);
		run(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				"--package-lock",
				tarballPath,
			],
			{
				cwd: consumerDir,
				env: cleanEnv,
				timeout: 300_000,
			},
		);

		const lock = readJson(join(consumerDir, "package-lock.json"));
		const senpiLock = packageLockEntry(
			lock,
			"node_modules/@code-yeongyu/senpi",
		);
		const senpiManifest = readJson(
			join(consumerDir, "node_modules/@code-yeongyu/senpi/package.json"),
		);
		if (senpiManifest.version !== expectedSenpiVersion) {
			throw new Error(
				`Packed omo-ai resolved Senpi ${senpiManifest.version}; expected published ${expectedSenpiVersion}`,
			);
		}
		if (
			senpiLock.version !== expectedSenpiVersion ||
			senpiLock.resolved !== expectedSenpiTarball
		) {
			throw new Error(
				`Packed consumer provenance mismatch: ${JSON.stringify({ version: senpiLock.version, resolved: senpiLock.resolved })}`,
			);
		}

		const driverOutput = run(process.execPath, [driverPath], {
			cwd: consumerDir,
			env: cleanEnv,
			timeout: 120_000,
		}).trim();
		const driverResult = JSON.parse(driverOutput.split("\n").at(-1) ?? "null");
		if (driverResult?.ok !== true)
			throw new Error(`Installed Senpi hooks driver failed: ${driverOutput}`);
		const expectedSenpiRoot = join(
			consumerDir,
			"node_modules/@code-yeongyu/senpi",
		);
		if (driverResult.senpiRoot !== expectedSenpiRoot)
			throw new Error("Hooks driver did not load consumer-local Senpi");

		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				packedOmoAiVersion: packageLockEntry(lock, "node_modules/omo-ai")
					.version,
				resolvedSenpiVersion: senpiLock.version,
				resolvedSenpiTarball: senpiLock.resolved,
				installedSenpiRoot: driverResult.senpiRoot,
				isolation: {
					nodePath: cleanEnv.NODE_PATH,
					npmCache: "fresh-per-run",
					installation: "consumer-local",
				},
				hooks: driverResult,
			})}\n`,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

await main();
