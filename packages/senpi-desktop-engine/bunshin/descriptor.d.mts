export type SidecarEffect = "read" | "mutate";

export interface DesktopDescriptor {
	readonly name: "desktop";
	readonly kind: "sidecar";
	readonly version: string;
	readonly description: string;
	readonly ops: readonly string[];
	readonly effects: Readonly<Record<string, SidecarEffect>>;
	readonly schemas: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly sidecar: {
		readonly executable: string;
		readonly args: readonly string[];
		readonly protocol: "json-rpc-stdio";
		readonly timeoutMs: number;
	};
	readonly sandbox: { readonly grant: "full_access" };
}

export interface DesktopDescriptorOptions {
	readonly executable: string;
	readonly version: string;
	readonly bunshinHome: string;
	readonly platform?: NodeJS.Platform;
}

export function desktopDescriptor(options: DesktopDescriptorOptions): DesktopDescriptor;
