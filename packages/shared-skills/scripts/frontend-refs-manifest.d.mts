export type MaterializeSource = { upstream: string; source: string };
export type MaterializeMap = Record<string, MaterializeSource>;

export const sharedSkillsRoot: string;
export const frontendSkillRoot: string;
export const upstreamsRoot: string;
export const designOriginals: readonly string[];
export const brandStems: readonly string[];
export const tasteSkillFiles: Record<string, string>;
export const tasteSkillArtifactFiles: Record<string, string>;
export const uiUxDbFileRenames: Record<string, string>;
export const uiUxDbScripts: readonly string[];

export function brandDesignFiles(): string[];
export function designMaterializeMap(): MaterializeMap;
export function uiUxDbMaterializeMap(): MaterializeMap;
export function thirdPartyMaterializeMap(): MaterializeMap;
export function thirdPartyRelativePaths(): string[];
export function designpowersThirdPartyRelativePaths(): string[];
export function keptDesignRelativePaths(): string[];
