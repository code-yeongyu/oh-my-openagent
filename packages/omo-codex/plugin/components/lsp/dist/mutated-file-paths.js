const MUTATION_TOOL_NAMES = new Set(["apply_patch", "write", "edit", "multiedit", "multi_edit"]);
export function extractMutatedFilePaths(input) {
    if (!isMutationTool(input.tool_name))
        return [];
    if (isFailedToolResponse(input.tool_response))
        return [];
    const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
    const paths = new Set();
    addStringValue(paths, toolInput["path"]);
    addStringValue(paths, toolInput["filePath"]);
    addStringValue(paths, toolInput["file_path"]);
    addStringArray(paths, toolInput["paths"]);
    addStringArray(paths, toolInput["filePaths"]);
    addStringArray(paths, toolInput["file_paths"]);
    addPatchPayloads(paths, toolInput);
    addPatchFiles(paths, toolInput["files"]);
    addPatchFiles(paths, toolInput["changes"]);
    return [...paths];
}
function isMutationTool(value) {
    if (typeof value !== "string")
        return false;
    return MUTATION_TOOL_NAMES.has(value.toLowerCase());
}
function isFailedToolResponse(value) {
    if (!isRecord(value))
        return false;
    return (value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error");
}
function addStringValue(paths, value) {
    if (typeof value === "string" && value.length > 0) {
        paths.add(value);
    }
}
function addStringArray(paths, value) {
    if (!Array.isArray(value))
        return;
    for (const item of value) {
        addStringValue(paths, item);
    }
}
function addPatchPayloads(paths, input) {
    addPatchInput(paths, input["input"]);
    addPatchInput(paths, input["patch"]);
    addPatchInput(paths, input["command"]);
}
function addPatchInput(paths, value) {
    if (typeof value !== "string")
        return;
    for (const line of value.split("\n")) {
        const path = extractPatchHeaderPath(line);
        if (path !== undefined)
            paths.add(path);
    }
}
function extractPatchHeaderPath(line) {
    const prefixes = ["*** Add File: ", "*** Update File: ", "*** Move to: "];
    for (const prefix of prefixes) {
        if (line.startsWith(prefix))
            return line.slice(prefix.length).trim();
    }
    return undefined;
}
function addPatchFiles(paths, value) {
    if (!Array.isArray(value))
        return;
    for (const item of value) {
        if (!isRecord(item))
            continue;
        addStringValue(paths, item["path"]);
        addStringValue(paths, item["filePath"]);
        addStringValue(paths, item["file_path"]);
        addStringValue(paths, item["movePath"]);
        addStringValue(paths, item["move_path"]);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
