import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [repositoryRoot] = process.argv.slice(2);
if (!repositoryRoot) throw new Error("repository root argument is required");
const root = realpathSync(repositoryRoot);
const { createWorkspaceEditTestHarness, readEvents, renameTextEdit, waitForEventCount } = await import(
	pathToFileURL(join(root, "packages/lsp-core/src/lsp/workspace-apply-edit-test-support.ts")).href
);

const harness = createWorkspaceEditTestHarness();

try {
	const pre = await harness.makeClient({
		renameSteps: [
			{
				applyDelayMs: 200,
				applyEdit: renameTextEdit("before", "after", { version: 1 }),
				renameResult: "same",
			},
		],
	});
	const preBefore = hashFile(pre.source);
	const preController = new AbortController();
	const preRename = pre.client.rename(pre.source, 1, 6, "after", preController.signal).catch((error) => error);
	await waitForEventCount(
		pre.events,
		(event) => event.type === "clientRequest" && event.method === "textDocument/rename",
		1,
	);
	preController.abort();
	const preResult = await preRename;
	const [preCancel] = await waitForEventCount(
		pre.events,
		(event) => event.type === "clientNotification" && event.method === "$/cancelRequest",
		1,
	);
	const preAfter = hashFile(pre.source);
	assert(preResult instanceof Error && /cancel/i.test(preResult.message), "pre-gate rename did not cancel");
	assert(preBefore === preAfter, "pre-gate cancellation mutated the file");

	const post = await harness.makeClient({
		renameSteps: [
			{
				applyEdit: renameTextEdit("before", "after", { version: 1 }),
				renameResult: "same",
			},
		],
	});
	let writeCount = 0;
	const postController = new AbortController();
	post.client.setWorkspaceEditIo({
		writeFile(path, data) {
			writeCount += 1;
			postController.abort();
			return import("node:fs").then(({ writeFileSync }) => writeFileSync(path, data));
		},
	});
	const postBefore = hashFile(post.source);
	const postResult = await post.client.rename(post.source, 1, 6, "after", postController.signal);
	const postAfter = hashFile(post.source);
	const postEvents = readEvents(post.events);
	assert(postResult.apply.success === true, "post-gate rename did not complete");
	assert(postResult.apply.lateAbort === true, "post-gate abort was not reported as late");
	assert(postResult.apply.totalEdits === 1, "post-gate rename did not report exactly one edit");
	assert(writeCount === 1, "post-gate rename did not perform exactly one write");
	assert(postBefore !== postAfter, "post-gate rename did not mutate the file");

	console.log(
		JSON.stringify(
			{
				preGate: {
					cancelTarget: preCancel.params?.id,
					hashBefore: preBefore,
					hashAfter: preAfter,
					mutated: preBefore !== preAfter,
					error: preResult.message,
				},
				postGate: {
					hashBefore: postBefore,
					hashAfter: postAfter,
					writeCount,
					success: postResult.apply.success,
					lateAbort: postResult.apply.lateAbort === true,
					totalEdits: postResult.apply.totalEdits,
					applyEditResponses: postEvents.filter(
						(event) => event.type === "clientResponse" && event.method === "workspace/applyEdit",
					).length,
				},
			},
			null,
			2,
		),
	);
} finally {
	await harness.cleanup();
}

function hashFile(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
