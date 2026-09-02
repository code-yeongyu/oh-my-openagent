import { invalid, literal, textField } from "./quality-gate-fields.js";
export function passedVerdict(value, field) {
    if (value === "not_applicable")
        invalid(`${field} must not be not_applicable.`, field);
    return literal(value, "passed", field);
}
export function codeQualityStatusField(value, field) {
    if (value === "CLEAR" || value === "WATCH")
        return value;
    invalid(`${field} must be CLEAR or WATCH.`, field);
}
export function adversarialVerdict(row, field) {
    const value = row["verdict"];
    if (value === "passed")
        return { verdict: "passed" };
    if (value === "not_applicable") {
        return { verdict: "not_applicable", reason: textField(row["reason"], `${field}.reason`) };
    }
    invalid(`${field} must be passed or not_applicable with a reason.`, field);
}
