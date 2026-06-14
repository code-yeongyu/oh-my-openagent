import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isRetriableRenameError, writeFileAtomic } from "./install/atomic-write.mjs";

test("#given a fresh target path #when writeFileAtomic writes content #then the file holds exactly that content with no temp residue", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-atomic-write-fresh-"));
	const target = join(root, "config.toml");

	// when
	await writeFileAtomic(target, "alpha = 1\n");

	// then
	assert.equal(await readFile(target, "utf8"), "alpha = 1\n");
	assert.deepEqual(await readdir(root), ["config.toml"]);
});

test("#given an existing file #when writeFileAtomic overwrites it #then the content is replaced with no temp residue", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-atomic-write-replace-"));
	const target = join(root, "config.toml");
	await writeFile(target, "old = true\n");

	// when
	await writeFileAtomic(target, "new = true\n");

	// then
	assert.equal(await readFile(target, "utf8"), "new = true\n");
	const residue = (await readdir(root)).filter((entry) => entry.startsWith(".tmp-"));
	assert.deepEqual(residue, []);
});

test("#given the rename target cannot be replaced #when writeFileAtomic fails #then the original is untouched and the temp file is cleaned up", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-atomic-write-fail-"));
	const target = join(root, "config.toml");
	await mkdir(target);
	await writeFile(join(target, "sentinel"), "keep\n");

	// when
	await assert.rejects(writeFileAtomic(target, "should not land\n"));

	// then
	assert.equal(await readFile(join(target, "sentinel"), "utf8"), "keep\n");
	const residue = (await readdir(root)).filter((entry) => entry.startsWith(".tmp-"));
	assert.deepEqual(residue, []);
});

test("#given the target is a symlink #when writeFileAtomic writes #then it writes through to the link target and preserves the symlink", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-atomic-write-symlink-"));
	const realTarget = join(root, "actual.toml");
	const link = join(root, "config.toml");
	await writeFile(realTarget, "old = true\n");
	await symlink(realTarget, link);

	// when
	await writeFileAtomic(link, "new = true\n");

	// then
	assert.equal(await readFile(realTarget, "utf8"), "new = true\n");
	assert.equal((await lstat(link)).isSymbolicLink(), true);
	const residue = (await readdir(root)).filter((entry) => entry.startsWith(".tmp-"));
	assert.deepEqual(residue, []);
});

test("#given various rename errors #when classifying retriability #then only Windows file-lock codes are retriable", () => {
	// given
	const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
	const perm = Object.assign(new Error("perm"), { code: "EPERM" });
	const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

	// when / then
	assert.equal(isRetriableRenameError(busy), true);
	assert.equal(isRetriableRenameError(perm), true);
	assert.equal(isRetriableRenameError(missing), false);
	assert.equal(isRetriableRenameError("not an error"), false);
});
