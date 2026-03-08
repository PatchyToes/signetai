import { isAbsolute, join, normalize, resolve } from "node:path";
import { loadMemoryConfig } from "./memory-config";
import { resolvePredictorCheckpointPath } from "./predictor-client";

function normalizePath(path: string): string {
	return normalize(path);
}

function resolveForComparison(path: string): string {
	return normalizePath(isAbsolute(path) ? path : resolve(path));
}

export function createAgentsWatcherIgnoreMatcher(agentsDir: string): (path: string) => boolean {
	const defaultPredictorCheckpoint = normalizePath(join(agentsDir, "memory", "predictor", "model.bin"));
	const configuredPredictorCheckpoint = resolveForComparison(
		resolvePredictorCheckpointPath(loadMemoryConfig(agentsDir).pipelineV2.predictor),
	);
	const ignoredPaths = new Set([defaultPredictorCheckpoint, configuredPredictorCheckpoint]);

	return (path: string): boolean => {
		const normalizedPath = resolveForComparison(path);
		return (
			ignoredPaths.has(normalizedPath) ||
			normalizedPath.endsWith(".db-wal") ||
			normalizedPath.endsWith(".db-shm") ||
			normalizedPath.endsWith(".db-journal")
		);
	};
}
