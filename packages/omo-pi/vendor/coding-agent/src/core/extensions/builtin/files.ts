/**
 * Files Extension
 *
 * /files command lists all files the model has read/written/edited in the active session branch,
 * coalesced by path and sorted newest first. Selecting a file opens it in VS Code.
 */

import { Container, Key, matchesKey, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "../../../modes/interactive/components/dynamic-border.ts";
import type { ExtensionAPI } from "../types.ts";
import { extractPatchedPaths } from "./gpt-apply-patch/index.ts";

interface FileEntry {
	path: string;
	operations: Set<"read" | "write" | "edit">;
	lastTimestamp: number;
}

type FileToolName = "read" | "write" | "edit";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("files", {
		description: "Show files read/written/edited in this session",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No UI available", "error");
				return;
			}

			// Get the current branch (path from leaf to root)
			const branch = ctx.sessionManager.getBranch();

			// First pass: collect tool calls (id -> {path, name}) from assistant messages
			const toolCalls = new Map<string, { paths: string[]; name: FileToolName; timestamp: number }>();

			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const msg = entry.message;

				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "toolCall") {
							const name = block.name;
							if (name === "read" || name === "write" || name === "edit") {
								const path = block.arguments?.path;
								if (path && typeof path === "string") {
									toolCalls.set(block.id, { paths: [path], name, timestamp: msg.timestamp });
								}
							} else if (name === "apply_patch") {
								const input = block.arguments?.input;
								if (typeof input === "string") {
									const paths = extractPatchedPaths(input);
									if (paths.length > 0) {
										toolCalls.set(block.id, { paths, name: "edit", timestamp: msg.timestamp });
									}
								}
							}
						}
					}
				}
			}

			// Second pass: match tool results to get the actual execution timestamp
			const fileMap = new Map<string, FileEntry>();

			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const msg = entry.message;

				if (msg.role === "toolResult") {
					const toolCall = toolCalls.get(msg.toolCallId);
					if (!toolCall) continue;

					const { paths, name } = toolCall;
					const timestamp = msg.timestamp;
					for (const path of paths) {
						const existing = fileMap.get(path);
						if (existing) {
							existing.operations.add(name);
							if (timestamp > existing.lastTimestamp) {
								existing.lastTimestamp = timestamp;
							}
						} else {
							fileMap.set(path, {
								path,
								operations: new Set([name]),
								lastTimestamp: timestamp,
							});
						}
					}
				}
			}

			if (fileMap.size === 0) {
				ctx.ui.notify("No files read/written/edited in this session", "info");
				return;
			}

			// Sort by most recent first
			const files = Array.from(fileMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);

			const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>^%\r\n]/;
			const quoteCmdArg = (value: string) => `"${value.replace(/"/g, '""')}"`;

			const openWithCode = async (path: string) => {
				if (process.platform === "win32") {
					if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(path)) {
						ctx.ui.notify(
							`Refusing to open ${path}: path contains Windows cmd metacharacters (& | < > ^ % or newline).`,
							"error",
						);
						return null;
					}
					const commandLine = `code -g ${quoteCmdArg(path)}`;
					return pi.exec("cmd", ["/d", "/s", "/c", commandLine], { cwd: ctx.cwd });
				}
				return pi.exec("code", ["-g", path], { cwd: ctx.cwd });
			};

			const openSelected = async (file: FileEntry): Promise<void> => {
				try {
					const openResult = await openWithCode(file.path);
					if (!openResult) return;
					if (openResult.code !== 0) {
						const openStderr = openResult.stderr.trim();
						ctx.ui.notify(
							`Failed to open ${file.path} (exit ${openResult.code})${openStderr ? `: ${openStderr}` : ""}`,
							"error",
						);
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to open ${file.path}: ${message}`, "error");
				}
			};

			// Show file picker with SelectList
			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();

				// Top border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				// Title
				container.addChild(new Text(theme.fg("accent", theme.bold(" Select file to open")), 0, 0));

				// Build select items with colored operations
				const filesByValue = new Map<string, FileEntry>();
				const items: SelectItem[] = files.map((f, i) => {
					const key = String(i);
					filesByValue.set(key, f);
					const ops: string[] = [];
					if (f.operations.has("read")) ops.push(theme.fg("muted", "R"));
					if (f.operations.has("write")) ops.push(theme.fg("success", "W"));
					if (f.operations.has("edit")) ops.push(theme.fg("warning", "E"));
					const opsLabel = ops.join("");
					return {
						value: key,
						label: `${opsLabel} ${f.path}`,
					};
				});

				const visibleRows = Math.min(files.length, 15);
				let currentIndex = 0;

				const selectList = new SelectList(items, visibleRows, {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => t, // Keep existing colors
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => {
					const fileEntry = filesByValue.get(item.value);
					if (fileEntry) void openSelected(fileEntry);
				};
				selectList.onCancel = () => done();
				selectList.onSelectionChange = (item) => {
					currentIndex = items.indexOf(item);
				};
				container.addChild(selectList);

				// Help text
				container.addChild(new Text(theme.fg("dim", " ↑↓ navigate • ←→ page • enter open • esc close"), 0, 0));

				// Bottom border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						// Add paging with left/right
						if (matchesKey(data, Key.left)) {
							// Page up - clamp to 0
							currentIndex = Math.max(0, currentIndex - visibleRows);
							selectList.setSelectedIndex(currentIndex);
						} else if (matchesKey(data, Key.right)) {
							// Page down - clamp to last
							currentIndex = Math.min(items.length - 1, currentIndex + visibleRows);
							selectList.setSelectedIndex(currentIndex);
						} else {
							selectList.handleInput(data);
						}
						tui.requestRender();
					},
				};
			});
		},
	});
}
