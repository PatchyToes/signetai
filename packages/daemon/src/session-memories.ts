/**
 * Session memory candidate recording and FTS hit tracking.
 *
 * Records which memories were considered and injected at session start,
 * and tracks FTS hits during user prompt handling. This data feeds
 * the continuity scorer and (eventually) the predictive memory scorer.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDbAccessor } from "./db-accessor";
import { logger } from "./logger";

let cachedDbPath: string | undefined;

function getMemoryDbPath(): string {
	if (cachedDbPath) return cachedDbPath;
	const agentsDir = process.env.SIGNET_PATH || join(homedir(), ".agents");
	cachedDbPath = join(agentsDir, "memory", "memories.db");
	return cachedDbPath;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMemoryCandidate {
	readonly id: string;
	readonly effScore: number;
	readonly source: "effective" | "fts_only";
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Batch-insert all candidate memories for a session. Candidates that
 * were actually injected get was_injected=1; the rest get 0.
 * Safe to call with an empty candidates array (no-op).
 */
export function recordSessionCandidates(
	sessionKey: string | undefined,
	candidates: ReadonlyArray<SessionMemoryCandidate>,
	injectedIds: ReadonlySet<string>,
): void {
	if (!sessionKey || candidates.length === 0 || !existsSync(getMemoryDbPath())) return;

	try {
		const now = new Date().toISOString();
		getDbAccessor().withWriteTx((db) => {
			const count = candidates.length;
			const params: Array<string | number> = new Array(count * 9);
			for (let i = 0; i < count; i++) {
				const c = candidates[i];
				const offset = i * 9;
				params[offset] = crypto.randomUUID();
				params[offset + 1] = sessionKey;
				params[offset + 2] = c.id;
				params[offset + 3] = c.source;
				params[offset + 4] = c.effScore;
				params[offset + 5] = c.effScore;
				params[offset + 6] = i;
				params[offset + 7] = injectedIds.has(c.id) ? 1 : 0;
				params[offset + 8] = now;
			}

			const placeholders = Array(count).fill("(?,?,?,?,?,?,?,?,0,?)").join(",");
			db.prepare(
				`INSERT OR IGNORE INTO session_memories
				 (id, session_key, memory_id, source, effective_score,
				  final_score, rank, was_injected, fts_hit_count, created_at)
				 VALUES ${placeholders}`,
			).run(...params);
		});

		logger.debug("session-memories", "Recorded session candidates", {
			sessionKey,
			total: candidates.length,
			injected: injectedIds.size,
		});
	} catch (e) {
		// Non-fatal — don't break session start for recording failures
		logger.warn("session-memories", "Failed to record candidates", {
			error: (e as Error).message,
		});
	}
}

// ---------------------------------------------------------------------------
// FTS hit tracking
// ---------------------------------------------------------------------------

/**
 * Increment fts_hit_count for memories matched during user prompt handling.
 * If a memory wasn't a session-start candidate, inserts a new row with
 * source='fts_only'.
 */
export function trackFtsHits(sessionKey: string | undefined, matchedIds: ReadonlyArray<string>): void {
	if (!sessionKey || matchedIds.length === 0 || !existsSync(getMemoryDbPath())) return;

	try {
		getDbAccessor().withWriteTx((db) => {
			const now = new Date().toISOString();

			const upsertStmt = db.prepare(
				`INSERT INTO session_memories
				 (id, session_key, memory_id, source, effective_score,
				  final_score, rank, was_injected, fts_hit_count, created_at)
				 VALUES (?, ?, ?, 'fts_only', 0, 0, 0, 0, 1, ?)
				 ON CONFLICT(session_key, memory_id) DO UPDATE SET
				 fts_hit_count = fts_hit_count + 1`,
			);

			for (const id of matchedIds) {
				upsertStmt.run(crypto.randomUUID(), sessionKey, id, now);
			}
		});
	} catch (e) {
		logger.warn("session-memories", "Failed to track FTS hits", {
			error: (e as Error).message,
		});
	}
}
