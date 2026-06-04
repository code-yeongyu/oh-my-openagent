export declare function getPlatformPackage(options: {
  platform: string;
  arch: string;
  libcFamily?: string | null;
  packageBaseName?: string;
}): string;

export declare function getPlatformPackageCandidates(options: {
  platform: string;
  arch: string;
  libcFamily?: string | null;
  preferBaseline?: boolean;
  packageBaseName?: string;
}): string[];

export declare function getBinaryPath(pkg: string, platform?: string): string;

export declare function getPackageBareName(packageName: string): string;

export declare function resolvePlatformPackageBaseName(wrapperPackageName: string): string;
