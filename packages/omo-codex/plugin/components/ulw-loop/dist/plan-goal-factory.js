import { UlwLoopError } from "./types.js";
function cleanLine(line) {
    return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
}
function normalizeObjective(value) {
    return value.replace(/\s+/g, " ").trim();
}
function titleFromObjective(objective, fallback) {
    const firstLine = objective
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? fallback;
    return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine;
}
function normalizeGoalId(title, index) {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 36)
        .replace(/-+$/g, "");
    return `G${String(index + 1).padStart(3, "0")}${slug ? `-${slug}` : ""}`;
}
function assertNonEmpty(value, label) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new UlwLoopError(`Missing ${label}.`, "ULW_LOOP_ARGUMENT_MISSING");
    return trimmed;
}
function truncateObjective(objective) {
    return objective.length > 80 ? `${objective.slice(0, 77).trimEnd()}...` : objective;
}
export function seedDefaultSuccessCriteria(goalIndex, objective) {
    const subject = truncateObjective(normalizeObjective(objective) || `Goal ${goalIndex + 1}`);
    const rows = [
        [
            "C001",
            "happy",
            `happy path for: ${subject}`,
            `Replace via revise_criterion with observable happy-path proof for goal ${goalIndex + 1}.`,
            true,
        ],
        [
            "C002",
            "edge",
            "edge case (boundary/empty/malformed)",
            `Replace via revise_criterion with boundary or malformed-input proof for: ${subject}.`,
            true,
        ],
        [
            "C003",
            "regression",
            "regression: adjacent surface still works",
            `Replace via revise_criterion with regression proof for neighboring behavior after: ${subject}.`,
            false,
        ],
    ];
    return rows.map(([id, userModel, scenario, expectedEvidence, essential]) => ({
        id,
        scenario,
        userModel,
        expectedEvidence,
        essential,
        capturedEvidence: null,
        status: "pending",
    }));
}
export function deriveGoalCandidates(brief) {
    const bulletGoals = brief
        .split(/\r?\n/)
        .map((line) => ({ original: line, cleaned: normalizeObjective(cleanLine(line)) }))
        .filter(({ cleaned }) => cleaned.length > 0 && cleaned.length <= 1200)
        .filter(({ original, cleaned }, index, all) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(original) &&
        all.findIndex((candidate) => candidate.cleaned === cleaned) === index)
        .map(({ cleaned }) => cleaned);
    const paragraphs = brief
        .split(/\n\s*\n/)
        .map(normalizeObjective)
        .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
    const selected = (bulletGoals.length > 0 ? bulletGoals : paragraphs).length > 0
        ? bulletGoals.length > 0
            ? bulletGoals
            : paragraphs
        : ["Complete the requested project objective."];
    return selected.map((objective, index) => ({
        title: titleFromObjective(objective, `Goal ${index + 1}`),
        objective,
    }));
}
export function makeGoal(title, objective, index, now) {
    const cleanTitle = assertNonEmpty(title, "title");
    const cleanObjective = assertNonEmpty(objective, "objective");
    return {
        id: normalizeGoalId(cleanTitle, index),
        title: cleanTitle,
        objective: cleanObjective,
        status: "pending",
        successCriteria: seedDefaultSuccessCriteria(index, cleanObjective),
        attempt: 0,
        createdAt: now,
        updatedAt: now,
    };
}
export function appendGoalToPlan(plan, title, objective, now) {
    const goal = makeGoal(title, objective, plan.goals.length, now);
    plan.goals.push(goal);
    plan.updatedAt = now;
    return goal;
}
