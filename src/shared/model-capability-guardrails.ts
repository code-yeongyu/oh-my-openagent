import {
	collectModelCapabilityGuardrailIssues as collectModelCapabilityGuardrailIssuesFromCore,
	getBuiltInRequirementModelIDs,
} from "@oh-my-opencode/model-core"
import type {
	ModelCapabilityGuardrailIssue,
	ModelCapabilitiesSnapshot,
} from "@oh-my-opencode/model-core"
import { getBundledModelCapabilitiesSnapshotForRuntime } from "./model-capabilities"

export { getBuiltInRequirementModelIDs }
export type { ModelCapabilityGuardrailIssue }

export function collectModelCapabilityGuardrailIssues(input: {
	snapshot?: ModelCapabilitiesSnapshot
	requirementModelIDs?: Iterable<string>
} = {}): ModelCapabilityGuardrailIssue[] {
	return collectModelCapabilityGuardrailIssuesFromCore({
		...input,
		snapshot: input.snapshot ?? getBundledModelCapabilitiesSnapshotForRuntime(),
	})
}
