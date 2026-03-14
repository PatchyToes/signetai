/**
 * One-time config migration for existing agent.yaml files.
 * Flips pipeline subsystem defaults to ON (except trainingTelemetry → OFF).
 * Guarded by `configVersion: 2` to prevent re-running.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

// Flat keys: flip false → true
const FLIP_TRUE = [
	"semanticContradictionEnabled",
	"graphEnabled",
	"rerankerEnabled",
	"autonomousEnabled",
	"allowUpdateDelete",
	"rehearsal_enabled",
	"agentFeedback",
] as const;

// Nested `enabled: false` under these parent keys → flip to true
const NESTED_PARENTS = ["graph", "reranker", "autonomous", "predictor"] as const;

// Note: regex-based — theoretically could match inside a YAML block scalar,
// but the target key names (semanticContradictionEnabled, etc.) are specific
// enough that false positives in description text are effectively impossible.
function flip(text: string, key: string): string {
	return text.replace(
		new RegExp(`^(\\s*${key}:\\s*)false(\\s*(?:#.*)?)$`, "m"),
		"$1true$2",
	);
}

// Require 2+ leading spaces so we only match inside a nested block (pipelineV2),
// not a top-level key that happens to share the same name.
function flipNested(text: string, parent: string): string {
	return text.replace(
		new RegExp(
			`(^[ ]{2,}${parent}:\\s*\\n(?:\\s+\\w+:.*\\n)*?\\s+enabled:\\s*)false`,
			"m",
		),
		"$1true",
	);
}

function flipTelemetryOff(text: string): string {
	return text.replace(
		/^(\s*trainingTelemetry:\s*)true(\s*(?:#.*)?)$/m,
		"$1false$2",
	);
}

export function migrateConfig(agentsDir: string): void {
	const candidates = ["agent.yaml", "AGENT.yaml"];
	let path: string | undefined;
	for (const name of candidates) {
		const p = join(agentsDir, name);
		if (existsSync(p)) {
			path = p;
			break;
		}
	}
	if (!path) return;

	let text: string;
	try {
		text = readFileSync(path, "utf-8");
	} catch {
		return;
	}

	// Already migrated (any version >= 2)
	const vMatch = /^configVersion:\s*(\d+)/m.exec(text);
	if (vMatch && Number(vMatch[1]) >= 2) return;

	const original = text;
	const mutations: string[] = [];

	for (const key of FLIP_TRUE) {
		const before = text;
		text = flip(text, key);
		if (text !== before) mutations.push(`${key}: false → true`);
	}

	for (const parent of NESTED_PARENTS) {
		const before = text;
		text = flipNested(text, parent);
		if (text !== before) mutations.push(`${parent}.enabled: false → true`);
	}

	{
		const before = text;
		text = flipTelemetryOff(text);
		if (text !== before) mutations.push("trainingTelemetry: true → false");
	}

	// Stamp version — insert after `---` if present to keep valid YAML
	if (text.startsWith("---\n") || text.startsWith("--- ")) {
		const nl = text.indexOf("\n");
		text = `${text.slice(0, nl + 1)}configVersion: 2\n${text.slice(nl + 1)}`;
	} else {
		text = `configVersion: 2\n${text}`;
	}
	writeFileSync(path, text, "utf-8");

	if (mutations.length > 0) {
		logger.info("config-migration", "Migrated agent.yaml defaults", {
			mutations,
			file: path,
		});
	}
}
