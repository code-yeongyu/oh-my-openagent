import { isAbsolute, resolve } from "node:path";
import { backupIfPresent, isRecord, jsonEqual, readJsonObject, writeJsonObject } from "../senpi-compat/json-file.mjs";
import {
  countTrustedOmoEntries,
  emptyHookTrustState,
  expectedOmoHookTrustRecords,
  isOmoOwnedTrustEntry,
  missingTrustEntryIds,
  trustEntryMatchesExpected,
} from "../senpi-compat/hook-trust.mjs";
import { findPackageRoot, OMO_PACKAGE_FILTERS, resolveAgentDir, senpiPaths } from "../senpi-compat/package-root.mjs";

export function repairSenpiInstall(options = {}) {
  return mutateSenpiInstall({ ...options, action: "repair" });
}

export function uninstallSenpiInstall(options = {}) {
  return mutateSenpiInstall({ ...options, action: "uninstall" });
}

export function inspectSenpiInstall(options = {}) {
  const context = createContext(options);
  const settings = readJsonObject(context.paths.settingsPath, {});
  const trustState = readJsonObject(context.paths.hooksStatePath, emptyHookTrustState());
  return createReport(context, settings, trustState, [], options.updatedAt ?? new Date().toISOString(), "doctor");
}

function mutateSenpiInstall(options) {
  const context = createContext(options);
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const backupPaths = [];
  const settings = readJsonObject(context.paths.settingsPath, {});
  const nextSettings = options.action === "uninstall"
    ? removePackageEntry(settings, context.packageRoot, context.agentDir)
    : ensurePackageEntry(settings, context.packageRoot, context.agentDir);
  if (!jsonEqual(settings, nextSettings)) {
    const backupPath = backupIfPresent(context.paths.settingsPath);
    if (backupPath) {
      backupPaths.push(backupPath);
    }
    writeJsonObject(context.paths.settingsPath, nextSettings);
  }

  const trustState = readJsonObject(context.paths.hooksStatePath, emptyHookTrustState());
  const nextTrustState = options.action === "uninstall"
    ? removeOmoTrustEntries(trustState, context)
    : ensureOmoTrustEntries(trustState, context, updatedAt);
  if (!jsonEqual(trustState, nextTrustState)) {
    const backupPath = backupIfPresent(context.paths.hooksStatePath);
    if (backupPath) {
      backupPaths.push(backupPath);
    }
    writeJsonObject(context.paths.hooksStatePath, nextTrustState);
  }

  return createReport(context, nextSettings, nextTrustState, backupPaths, updatedAt, options.action);
}

function createContext(options) {
  const packageRoot = options.packageRoot ?? findPackageRoot(import.meta.url);
  const agentDir = options.agentDir ?? resolveAgentDir();
  return {
    agentDir,
    packageRoot,
    paths: senpiPaths(packageRoot, agentDir),
  };
}

function ensurePackageEntry(settings, packageRoot, agentDir) {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const retained = packages.filter((entry) => !packageSourceMatches(entry, packageRoot, agentDir));
  const nextPackages = [...retained, { source: packageRoot, ...OMO_PACKAGE_FILTERS }];
  return { ...settings, packages: nextPackages };
}

function removePackageEntry(settings, packageRoot, agentDir) {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const nextPackages = packages.filter((entry) => !packageSourceMatches(entry, packageRoot, agentDir));
  if (nextPackages.length === packages.length && Array.isArray(settings.packages)) {
    return settings;
  }
  return { ...settings, packages: nextPackages };
}

function packageSourceMatches(entry, packageRoot, agentDir) {
  const source = typeof entry === "string" ? entry : isRecord(entry) ? entry.source : undefined;
  if (typeof source !== "string") {
    return false;
  }
  return resolvePackageSource(source, agentDir) === packageRoot;
}

function resolvePackageSource(source, baseDir) {
  if (isAbsolute(source)) {
    return resolve(source);
  }
  if (source.startsWith("~/")) {
    return resolve(process.env.HOME ?? "", source.slice(2));
  }
  return resolve(baseDir, source);
}

function ensureOmoTrustEntries(trustState, context, updatedAt) {
  const hooks = isRecord(trustState.hooks) ? trustState.hooks : {};
  const records = expectedOmoHookTrustRecords(context.paths, { updatedAt });
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const nextHooks = {};
  for (const [id, entry] of Object.entries(hooks)) {
    if (!isOmoOwnedTrustEntry(id, entry, recordsById, context.paths.hooksManifestPath)) {
      nextHooks[id] = entry;
    }
  }
  for (const record of records) {
    const current = hooks[record.id];
    nextHooks[record.id] = trustEntryMatchesExpected(current, record.stableEntry) ? current : record.entry;
  }
  return { version: 1, hooks: sortRecord(nextHooks) };
}

function removeOmoTrustEntries(trustState, context) {
  const hooks = isRecord(trustState.hooks) ? trustState.hooks : {};
  const records = expectedOmoHookTrustRecords(context.paths);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const nextHooks = {};
  for (const [id, entry] of Object.entries(hooks)) {
    if (!isOmoOwnedTrustEntry(id, entry, recordsById, context.paths.hooksManifestPath)) {
      nextHooks[id] = entry;
    }
  }
  return { version: 1, hooks: sortRecord(nextHooks) };
}

function createReport(context, settings, trustState, backupPaths, updatedAt, action) {
  const hooks = isRecord(trustState.hooks) ? trustState.hooks : {};
  const records = expectedOmoHookTrustRecords(context.paths, { updatedAt });
  const packageEntryCount = countPackageEntries(settings, context.packageRoot, context.agentDir);
  const missingTrustEntries = missingTrustEntryIds(hooks, records);
  const omoTrustEntryCount = countTrustedOmoEntries(hooks, records);
  const problems = [];
  if (packageEntryCount !== 1 && action !== "uninstall") {
    problems.push(`Expected exactly one omo-ai package entry, found ${packageEntryCount}.`);
  }
  if (missingTrustEntries.length > 0 && action !== "uninstall") {
    problems.push(`Missing or stale OMO hook trust entries: ${missingTrustEntries.join(", ")}`);
  }
  return {
    ok: problems.length === 0,
    action,
    packageRoot: context.packageRoot,
    payloadRoot: context.paths.payloadRoot,
    settingsPath: context.paths.settingsPath,
    hooksStatePath: context.paths.hooksStatePath,
    packageEntryCount,
    packageEntryPresentExactlyOnce: packageEntryCount === 1,
    omoTrustEntryCount,
    expectedOmoTrustEntryCount: records.length,
    missingTrustEntries,
    backupPaths,
    problems,
    updatedAt,
  };
}

function countPackageEntries(settings, packageRoot, agentDir) {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  return packages.filter((entry) => packageSourceMatches(entry, packageRoot, agentDir)).length;
}

function sortRecord(record) {
  const sorted = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}
