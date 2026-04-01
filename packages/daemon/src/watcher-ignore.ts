import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { loadMemoryConfig } from "./memory-config";
import { resolvePredictorCheckpointPath } from "./predictor-client";

function normalizePath(path: string): string {
	return normalize(path);
}

function resolveForComparison(path: string): string {
	return normalizePath(isAbsolute(path) ? path : resolve(path));
}

function relativePathWithin(root: string, target: string): string | null {
	const rel = normalizePath(relative(root, target));
	if (rel === "" || rel === ".") return "";
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return rel;
}

/**
 * Built-in filename patterns for memory markdown files that should be excluded
 * from watcher-driven ingestion. These are temporal DAG artifacts and synthesis
 * backups that would otherwise flood the memory store with low-value chunks.
 *
 * Pattern semantics:
 * - Patterns are matched against the **filename** (basename without directory).
 * - A leading `*` matches any prefix. A trailing `*` matches any suffix.
 * - Patterns without wildcards require an exact filename match.
 */
const DEFAULT_INGEST_EXCLUDE_PATTERNS: string[] = [
	// MEMORY.md synthesis backups (e.g. MEMORY.backup-2026-03-31T14-02-20.md)
	"MEMORY.backup-*",
	// Temporal DAG session artifacts (e.g. 2026-03-31T14-18-24.399Z--y3mgugrv4vq2rmvn--summary.md)
	"*--summary.md",
	"*--transcript.md",
	"*--manifest.md",
];

/**
 * Test whether a filename matches a simple glob pattern.
 * Supports leading `*` (suffix match), trailing `*` (prefix match),
 * both (contains match), and exact match.
 */
export function matchesSimpleGlob(filename: string, pattern: string): boolean {
	const startsWithWild = pattern.startsWith("*");
	const endsWithWild = pattern.endsWith("*");

	if (startsWithWild && endsWithWild) {
		// *foo* → contains
		const inner = pattern.slice(1, -1);
		return inner.length > 0 && filename.includes(inner);
	}
	if (startsWithWild) {
		// *foo → suffix match
		return filename.endsWith(pattern.slice(1));
	}
	if (endsWithWild) {
		// foo* → prefix match
		return filename.startsWith(pattern.slice(0, -1));
	}
	// exact match
	return filename === pattern;
}

/**
 * Check whether a memory markdown file should be excluded from watcher-driven
 * ingestion based on built-in defaults and optional user-configured patterns.
 *
 * @param filePath - Absolute or relative path to the .md file
 * @param userPatterns - Additional exclude patterns from agent.yaml `watcher.ingestExclude`
 * @returns true if the file should be skipped
 */
export function shouldExcludeFromIngestion(filePath: string, userPatterns: string[] = []): boolean {
	const filename = basename(filePath);
	const allPatterns = [...DEFAULT_INGEST_EXCLUDE_PATTERNS, ...userPatterns];
	return allPatterns.some((pattern) => matchesSimpleGlob(filename, pattern));
}

export function createAgentsWatcherIgnoreMatcher(agentsDir: string): (path: string) => boolean {
	const defaultPredictorCheckpoint = normalizePath(join(agentsDir, "memory", "predictor", "model.bin"));
	const configuredPredictorCheckpoint = resolveForComparison(
		resolvePredictorCheckpointPath(loadMemoryConfig(agentsDir).pipelineV2.predictor),
	);
	const agentRoot = resolveForComparison(join(agentsDir, "agents"));
	const memoriesDb = resolveForComparison(join(agentsDir, "memory", "memories.db"));
	const memoriesDbWal = resolveForComparison(join(agentsDir, "memory", "memories.db-wal"));
	const memoriesDbShm = resolveForComparison(join(agentsDir, "memory", "memories.db-shm"));
	const memoriesDbJournal = resolveForComparison(join(agentsDir, "memory", "memories.db-journal"));
	const ignoredPaths = new Set([
		defaultPredictorCheckpoint,
		configuredPredictorCheckpoint,
		memoriesDb,
		memoriesDbWal,
		memoriesDbShm,
		memoriesDbJournal,
	]);

	return (path: string): boolean => {
		const normalizedPath = resolveForComparison(path);
		const relativeToAgentsRoot = relativePathWithin(agentRoot, normalizedPath);
		const agentSegments = relativeToAgentsRoot === null ? [] : relativeToAgentsRoot.split(/[\\/]+/).filter(Boolean);
		const isGeneratedWorkspacePath =
			agentSegments.length === 3 && agentSegments[1] === "workspace" && agentSegments[2] === "AGENTS.md";
		return isGeneratedWorkspacePath || ignoredPaths.has(normalizedPath);
	};
}
