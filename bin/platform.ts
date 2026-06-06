const PLATFORM_PACKAGE_BASE_BY_WRAPPER_NAME: Record<string, string> = {
  lazycodex: "oh-my-openagent",
  "lazycodex-ai": "oh-my-openagent",
};

export function getPackageBareName(packageName: string): string {
  return packageName.split("/").pop() || packageName;
}

export function resolvePlatformPackageBaseName(wrapperPackageName: string): string {
  const bareName = getPackageBareName(wrapperPackageName);
  return PLATFORM_PACKAGE_BASE_BY_WRAPPER_NAME[bareName] ?? wrapperPackageName;
}

interface PlatformPackageOptions {
  platform: string;
  arch: string;
  libcFamily?: string | null;
  packageBaseName?: string;
}

interface PlatformPackageCandidatesOptions extends PlatformPackageOptions {
  preferBaseline?: boolean;
}

export function getPlatformPackage({
  platform,
  arch,
  libcFamily,
  packageBaseName = "oh-my-opencode",
}: PlatformPackageOptions): string {
  let suffix = "";
  if (platform === "linux") {
    if (libcFamily === null || libcFamily === undefined) {
      throw new Error(
        "Could not detect libc on Linux. " +
          "Please ensure detect-libc is installed or report this issue."
      );
    }
    if (libcFamily === "musl") {
      suffix = "-musl";
    }
  }

  const os = platform === "win32" ? "windows" : platform;
  return `${packageBaseName}-${os}-${arch}${suffix}`;
}

export function getPlatformPackageCandidates({
  platform,
  arch,
  libcFamily,
  preferBaseline = false,
  packageBaseName = "oh-my-opencode",
}: PlatformPackageCandidatesOptions): string[] {
  const primaryPackage = getPlatformPackage({ platform, arch, libcFamily, packageBaseName });
  const baselinePackage = getBaselinePlatformPackage({ platform, arch, libcFamily, packageBaseName });

  if (!baselinePackage) {
    return [primaryPackage];
  }

  return preferBaseline ? [baselinePackage, primaryPackage] : [primaryPackage, baselinePackage];
}

function getBaselinePlatformPackage({
  platform,
  arch,
  libcFamily,
  packageBaseName = "oh-my-opencode",
}: PlatformPackageOptions): string | null {
  if (arch !== "x64") {
    return null;
  }

  if (platform === "darwin") {
    return `${packageBaseName}-darwin-x64-baseline`;
  }

  if (platform === "win32") {
    return `${packageBaseName}-windows-x64-baseline`;
  }

  if (platform === "linux") {
    if (libcFamily === null || libcFamily === undefined) {
      throw new Error(
        "Could not detect libc on Linux. " +
          "Please ensure detect-libc is installed or report this issue."
      );
    }

    if (libcFamily === "musl") {
      return `${packageBaseName}-linux-x64-musl-baseline`;
    }

    return `${packageBaseName}-linux-x64-baseline`;
  }

  return null;
}

export function getBinaryPath(pkg: string, _platform?: string): string {
  return `${pkg}/bin/oh-my-opencode.js`;
}
