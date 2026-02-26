export declare function getPlatformPackage(options: {
  platform: string;
  arch: string;
  libcFamily?: string | null;
}): string;

export declare function getPlatformPackageCandidates(options: {
  platform: string;
  arch: string;
  libcFamily?: string | null;
  preferBaseline?: boolean;
}): string[];

export declare function getBinaryPath(pkg: string, platform: string): string;
