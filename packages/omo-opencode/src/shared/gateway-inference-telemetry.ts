export type GatewayInferenceTelemetry = {
	costUsd?: number;
	tokensPerSecond?: number;
	model?: string;
};

type MessagePart = {
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
	const parsed = readFiniteNumber(value);
	if (parsed === undefined || parsed <= 0) return undefined;
	return parsed;
}

function findGatewayUsageFromParts(
	parts: unknown,
): Record<string, unknown> | undefined {
	if (!Array.isArray(parts)) return undefined;

	for (const part of parts) {
		if (!isRecord(part)) continue;
		if (!isRecord(part.metadata)) continue;

		if (isRecord(part.metadata.usage)) return part.metadata.usage;
		if (isRecord(part.metadata.omniroute)) return part.metadata.omniroute;
		if (isRecord(part.metadata.gateway)) return part.metadata.gateway;
	}

	return undefined;
}

export function preferGatewayInferenceTelemetry(message: {
	info?: Record<string, unknown>;
	parts?: MessagePart[];
}): GatewayInferenceTelemetry {
	const info = message.info ?? {};

	const infoUsage = isRecord(info.usage) ? info.usage : undefined;
	const partsUsage = findGatewayUsageFromParts(message.parts);
	const usage = infoUsage ?? partsUsage;

	if (!usage) {
		return {};
	}

	const tokensPerSecond =
		readPositiveNumber(usage.tokens_per_second) ??
		readPositiveNumber(usage.tokensPerSecond);

	if (tokensPerSecond === undefined) {
		return {};
	}

	const cost = readFiniteNumber(usage.cost);
	const model =
		typeof usage.model === "string" && usage.model.trim()
			? usage.model.trim()
			: undefined;

	const out: GatewayInferenceTelemetry = {};
	if (cost !== undefined && cost >= 0) out.costUsd = cost;
	out.tokensPerSecond = tokensPerSecond;
	if (model) out.model = model;
	return out;
}

export function formatGatewayTelemetryLine(
	telemetry: GatewayInferenceTelemetry,
): string {
	if (telemetry.tokensPerSecond === undefined) {
		return "";
	}

	const cost =
		telemetry.costUsd !== undefined
			? `cost $${telemetry.costUsd.toFixed(4)}`
			: "cost n/a";
	const tps = `tok/s ${telemetry.tokensPerSecond.toFixed(1)}`;
	const model = telemetry.model ? `model ${telemetry.model}` : undefined;

	return [cost, tps, model].filter(Boolean).join(" · ");
}
