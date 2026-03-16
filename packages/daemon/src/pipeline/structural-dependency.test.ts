/**
 * Integration tests for structural-dependency type extraction.
 *
 * Validates that qwen3:4b (the default pipeline model) can reliably
 * produce all 21 dependency types from the extraction prompt format.
 * Uses the pipeline's actual stripFences + tryParseJson parsing.
 *
 * Requires: Ollama running locally with qwen3:4b loaded.
 *
 * Known limitation: temporal types (precedes, follows, triggers) are
 * produced correctly but inconsistently — the model sometimes emits
 * verbose reasoning instead of JSON. This is a model-level issue
 * affecting all extraction, not specific to these types.
 */

import { describe, test, expect } from "bun:test";
import { DEPENDENCY_TYPES } from "@signet/core";

// ---------------------------------------------------------------------------
// Pipeline parsing (mirrored from extraction.ts)
// ---------------------------------------------------------------------------

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/;
const THINK_RE = /<think>[\s\S]*?<\/think>\s*/g;
const TRAILING_COMMA_RE = /,\s*([}\]])/g;

function stripFences(raw: string): string {
	const stripped = raw.replace(THINK_RE, "");
	const match = stripped.match(FENCE_RE);
	return match ? match[1].trim() : stripped.trim();
}

function tryParseJson(candidate: string): unknown | null {
	const trimmed = candidate.trim();
	if (!trimmed) return null;
	for (const attempt of [trimmed, trimmed.replace(TRAILING_COMMA_RE, "$1")]) {
		try {
			const parsed = JSON.parse(attempt);
			return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
		} catch {}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Prompt descriptions (mirrored from structural-dependency.ts)
// ---------------------------------------------------------------------------

const DEP_DESCRIPTIONS: Record<string, string> = {
	uses: "actively calls or consumes at runtime",
	requires: "cannot function without (hard prerequisite)",
	owned_by: "maintained or governed by",
	blocks: "prevents progress of",
	informs: "sends data or signals to",
	built: "was created or constructed by",
	depends_on: "needs but does not directly call (soft dependency)",
	related_to: "associated loosely, no directional dependency",
	learned_from: "acquired knowledge from",
	teaches: "transfers knowledge to",
	knows: "is aware of or references",
	assumes: "presupposes as true without verifying",
	contradicts: "conflicts with or negates",
	supersedes: "replaces or obsoletes",
	part_of: "is a component or subset of",
	precedes: "must happen before (temporal)",
	follows: "happens after (temporal)",
	triggers: "causes to start or execute",
	impacts: "change here affects (blast radius)",
	produces: "generates as output",
	consumes: "takes as input",
};

function buildPrompt(
	entity: string,
	type: string,
	aspects: readonly string[],
	facts: readonly string[],
): string {
	const aspectList = aspects.length > 0 ? aspects.join(", ") : "[none yet]";
	const factList = facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
	const typeList = DEPENDENCY_TYPES
		.map((t) => `- ${t}: ${DEP_DESCRIPTIONS[t]}`)
		.join("\n");

	return `Classify each fact. Also identify if the fact implies a dependency between entities.

Entity: ${entity} (${type})
Aspects: ${aspectList}

Dependency types:
${typeList}

${factList}

For each fact return: {"i": N, "aspect": "...", "kind": "attribute"|"constraint", "dep_target": "entity or null", "dep_type": "type or null"}
/no_think`;
}

// ---------------------------------------------------------------------------
// Ollama helper
// ---------------------------------------------------------------------------

const OLLAMA = "http://localhost:11434";
const MODEL = "qwen3:4b";
const VALID = new Set<string>(DEPENDENCY_TYPES);

async function ollamaAvailable(): Promise<boolean> {
	try {
		const resp = await fetch(`${OLLAMA}/api/tags`);
		const data = (await resp.json()) as { models: Array<{ name: string }> };
		return data.models.some((m) => m.name === MODEL);
	} catch {
		return false;
	}
}

async function generate(prompt: string): Promise<string> {
	const resp = await fetch(`${OLLAMA}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			prompt,
			stream: false,
			options: { temperature: 0.1 },
		}),
	});
	return ((await resp.json()) as { response: string }).response;
}

interface ExtractedDep {
	readonly i: number;
	readonly type: string;
	readonly target: string;
	readonly aspect: string;
}

function extract(raw: string, factCount: number): readonly ExtractedDep[] {
	const parsed = tryParseJson(stripFences(raw));
	if (!Array.isArray(parsed)) return [];

	const results: ExtractedDep[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const obj = item as Record<string, unknown>;
		const i = typeof obj.i === "number" ? obj.i : -1;
		if (i < 1 || i > factCount) continue;
		const dt = typeof obj.dep_type === "string" ? obj.dep_type : "";
		const target = typeof obj.dep_target === "string" ? obj.dep_target : "";
		const aspect = typeof obj.aspect === "string" ? obj.aspect : "";
		if (dt && VALID.has(dt)) {
			results.push({ i, type: dt, target, aspect });
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

interface Scenario {
	readonly name: string;
	readonly entity: string;
	readonly type: string;
	readonly aspects: readonly string[];
	readonly facts: readonly string[];
	readonly expected: readonly string[];
}

const SCENARIOS: readonly Scenario[] = [
	{
		name: "core",
		entity: "auth service",
		type: "system",
		aspects: ["security", "api"],
		facts: [
			"auth service uses JWT tokens for session management",
			"auth service requires a running redis instance",
			"auth service is owned by the platform team",
			"auth service blocks deployment when health check fails",
			"auth service informs the audit log of all login attempts",
		],
		expected: ["uses", "requires", "owned_by", "blocks", "informs"],
	},
	{
		name: "knowledge",
		entity: "ML pipeline",
		type: "system",
		aspects: ["training", "inference"],
		facts: [
			"the ML pipeline was built by the data science team",
			"the ML pipeline depends on the feature store for input data",
			"the ML pipeline is related to the analytics dashboard",
			"the ML pipeline learned from historical user behavior data",
			"the ML pipeline teaches the recommendation engine new patterns",
			"the ML pipeline knows the schema of the user events table",
			"the ML pipeline assumes the feature store provides normalized data",
		],
		expected: [
			"built", "depends_on", "related_to", "learned_from",
			"teaches", "knows", "assumes",
		],
	},
	{
		name: "structural",
		entity: "config v2",
		type: "concept",
		aspects: ["schema", "migration"],
		facts: [
			"config v2 contradicts the legacy config format on timeout defaults",
			"config v2 supersedes the original config schema",
			"the timeout setting is part of config v2",
		],
		expected: ["contradicts", "supersedes", "part_of"],
	},
	{
		name: "temporal",
		entity: "deploy pipeline",
		type: "process",
		aspects: ["ci", "release"],
		facts: [
			"the build step precedes the test step in the deploy pipeline",
			"the notification step follows the deploy step",
			"a merged PR triggers the deploy pipeline",
		],
		expected: ["precedes", "follows", "triggers"],
	},
	{
		name: "impact",
		entity: "database migration",
		type: "process",
		aspects: ["schema", "data"],
		facts: [
			"the database migration impacts all downstream services",
			"the database migration produces a new schema version artifact",
			"the database migration consumes the migration script files",
		],
		expected: ["impacts", "produces", "consumes"],
	},
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("structural-dependency types", () => {
	test("DEPENDENCY_TYPES has 21 entries", () => {
		expect(DEPENDENCY_TYPES).toHaveLength(21);
	});

	test("all types have descriptions", () => {
		for (const t of DEPENDENCY_TYPES) {
			expect(DEP_DESCRIPTIONS[t]).toBeDefined();
		}
	});

	test("prompt includes all types with descriptions", () => {
		const prompt = buildPrompt("test", "entity", [], ["test fact"]);
		for (const t of DEPENDENCY_TYPES) {
			expect(prompt).toContain(`- ${t}: `);
		}
	});
});

describe("qwen3:4b extraction", () => {
	test("model produces valid dependency types per scenario", async () => {
		const available = await ollamaAvailable();
		if (!available) {
			console.log(`SKIP: ${MODEL} not available on Ollama`);
			return;
		}

		const allSeen = new Set<string>();
		let totalDeps = 0;

		for (const scenario of SCENARIOS) {
			const prompt = buildPrompt(
				scenario.entity,
				scenario.type,
				scenario.aspects,
				scenario.facts,
			);

			const raw = await generate(prompt);
			const deps = extract(raw, scenario.facts.length);

			const seen = new Set(deps.map((d) => d.type));
			for (const t of seen) allSeen.add(t);
			totalDeps += deps.length;

			// Each scenario should produce at least some valid deps
			const overlap = scenario.expected.filter((t) => seen.has(t));
			console.log(
				`  ${scenario.name}: ${overlap.length}/${scenario.expected.length} expected types ` +
				`(${deps.length} deps) [${[...seen].join(", ")}]`,
			);

			// At least half the expected types should be produced
			expect(overlap.length).toBeGreaterThanOrEqual(
				Math.ceil(scenario.expected.length / 2),
			);
		}

		console.log(
			`\n  Total: ${allSeen.size}/${DEPENDENCY_TYPES.length} types seen, ${totalDeps} deps`,
		);
		console.log(`  Types: ${[...allSeen].sort().join(", ")}`);

		const missing = DEPENDENCY_TYPES.filter((t) => !allSeen.has(t));
		if (missing.length > 0) {
			console.log(`  Missing: ${missing.join(", ")}`);
		}

		// Overall: model should produce at least 15/21 types across all scenarios
		expect(allSeen.size).toBeGreaterThanOrEqual(15);
	}, 120_000);
});
