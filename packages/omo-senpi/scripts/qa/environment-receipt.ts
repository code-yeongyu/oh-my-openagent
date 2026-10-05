declare const process: {
	readonly env: Readonly<Record<string, string | undefined>>;
	cwd(): string;
	getBuiltinModule<T>(id: string): T;
};

type FsModule = {
	readonly writeFileSync: (path: string, data: string) => void;
};

type PathModule = {
	readonly join: (...paths: readonly string[]) => string;
};

type ExtensionApi = Readonly<Record<string, unknown>>;

const environmentReceiptFile = ".omo-senpi-qa-environment.json";
const { writeFileSync } = process.getBuiltinModule<FsModule>("fs");
const { join } = process.getBuiltinModule<PathModule>("path");

export default function recordQaEnvironment(_pi: ExtensionApi): void {
	writeFileSync(
		join(process.cwd(), environmentReceiptFile),
		`${JSON.stringify({
			HOME: process.env.HOME,
			USERPROFILE: process.env.USERPROFILE,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_DATA_HOME: process.env.XDG_DATA_HOME,
			XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
			SENPI_CODING_AGENT_DIR: process.env.SENPI_CODING_AGENT_DIR,
		})}\n`,
	);
}
