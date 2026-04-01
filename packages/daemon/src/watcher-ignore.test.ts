import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentsWatcherIgnoreMatcher, matchesSimpleGlob, shouldExcludeFromIngestion } from "./watcher-ignore";

const tmpDirs: string[] = [];

afterEach(() => {
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (!dir) continue;
		rmSync(dir, { recursive: true, force: true });
	}
});

function makeTempAgentsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "signet-watcher-ignore-"));
	tmpDirs.push(dir);
	return dir;
}

describe("createAgentsWatcherIgnoreMatcher", () => {
	it("ignores the default predictor checkpoint", () => {
		const agentsDir = makeTempAgentsDir();
		const shouldIgnore = createAgentsWatcherIgnoreMatcher(agentsDir);

		expect(shouldIgnore(join(agentsDir, "memory", "predictor", "model.bin"))).toBe(true);
		expect(shouldIgnore(join(agentsDir, "memory", "notes.md"))).toBe(false);
	});

	it("ignores a configured predictor checkpoint path", () => {
		const agentsDir = makeTempAgentsDir();
		const customCheckpoint = join(agentsDir, "custom", "predictor.bin");
		writeFileSync(
			join(agentsDir, "agent.yaml"),
			`memory:
  pipelineV2:
    predictor:
      checkpointPath: ${customCheckpoint}
`,
		);

		const shouldIgnore = createAgentsWatcherIgnoreMatcher(agentsDir);
		expect(shouldIgnore(customCheckpoint)).toBe(true);
		expect(shouldIgnore(join(agentsDir, "memory", "predictor", "model.bin"))).toBe(true);
	});

	it("ignores the daemon memories.db and its journal files", () => {
		const agentsDir = makeTempAgentsDir();
		const shouldIgnore = createAgentsWatcherIgnoreMatcher(agentsDir);

		expect(shouldIgnore(join(agentsDir, "memory", "memories.db"))).toBe(true);
		expect(shouldIgnore(join(agentsDir, "memory", "memories.db-wal"))).toBe(true);
		expect(shouldIgnore(join(agentsDir, "memory", "memories.db-shm"))).toBe(true);
		expect(shouldIgnore(join(agentsDir, "memory", "memories.db-journal"))).toBe(true);

		// User-managed .db files should NOT be ignored
		expect(shouldIgnore(join(agentsDir, "my-project", "data.db"))).toBe(false);
		expect(shouldIgnore(join(agentsDir, "notes.db"))).toBe(false);
	});

	it("ignores generated per-agent workspace AGENTS.md files", () => {
		const agentsDir = makeTempAgentsDir();
		const shouldIgnore = createAgentsWatcherIgnoreMatcher(agentsDir);

		expect(shouldIgnore(join(agentsDir, "agents", "claude-code", "workspace", "AGENTS.md"))).toBe(true);
		expect(shouldIgnore(join(agentsDir, "agents", "claude-code", "workspace", "nested-project", "AGENTS.md"))).toBe(
			false,
		);
		expect(shouldIgnore(join(agentsDir, "agents-backup", "claude-code", "workspace", "AGENTS.md"))).toBe(false);
		expect(shouldIgnore(join(agentsDir, "agents", "claude-code", "SOUL.md"))).toBe(false);
	});
});

describe("matchesSimpleGlob", () => {
	it("matches prefix patterns (trailing wildcard)", () => {
		expect(matchesSimpleGlob("MEMORY.backup-2026-03-31T14-02-20.md", "MEMORY.backup-*")).toBe(true);
		expect(matchesSimpleGlob("MEMORY.md", "MEMORY.backup-*")).toBe(false);
		expect(matchesSimpleGlob("notes.md", "MEMORY.backup-*")).toBe(false);
	});

	it("matches suffix patterns (leading wildcard)", () => {
		expect(matchesSimpleGlob("2026-03-31T14-18-24.399Z--y3mgugrv4vq2rmvn--summary.md", "*--summary.md")).toBe(true);
		expect(matchesSimpleGlob("abc--summary.md", "*--summary.md")).toBe(true);
		expect(matchesSimpleGlob("summary.md", "*--summary.md")).toBe(false);
		expect(matchesSimpleGlob("2026-03-31.md", "*--summary.md")).toBe(false);
	});

	it("matches contains patterns (both wildcards)", () => {
		expect(matchesSimpleGlob("foo-debug-bar.md", "*debug*")).toBe(true);
		expect(matchesSimpleGlob("nodebug.md", "*debug*")).toBe(true); // contains "debug"
		expect(matchesSimpleGlob("notes.md", "*debug*")).toBe(false);
	});

	it("matches exact patterns (no wildcards)", () => {
		expect(matchesSimpleGlob("scratch.md", "scratch.md")).toBe(true);
		expect(matchesSimpleGlob("scratch.txt", "scratch.md")).toBe(false);
	});
});

describe("shouldExcludeFromIngestion", () => {
	it("excludes MEMORY.backup files by default", () => {
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/MEMORY.backup-2026-03-31T14-02-20.md")).toBe(true);
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/MEMORY.backup-2026-04-01T00-19-18.md")).toBe(true);
	});

	it("excludes temporal DAG summary files by default", () => {
		expect(
			shouldExcludeFromIngestion(
				"/home/user/.agents/memory/2026-03-31T14-18-24.399Z--y3mgugrv4vq2rmvn--summary.md",
			),
		).toBe(true);
	});

	it("excludes temporal DAG transcript files by default", () => {
		expect(
			shouldExcludeFromIngestion(
				"/home/user/.agents/memory/2026-03-31T13-35-00.763Z--hmgekv4bp5yoqr6d--transcript.md",
			),
		).toBe(true);
	});

	it("excludes temporal DAG manifest files by default", () => {
		expect(
			shouldExcludeFromIngestion(
				"/home/user/.agents/memory/2026-03-31T14-18-24.399Z--y3mgugrv4vq2rmvn--manifest.md",
			),
		).toBe(true);
	});

	it("does NOT exclude regular memory files", () => {
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/2026-03-31.md")).toBe(false);
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/star-notes.md")).toBe(false);
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/2026-03-16-patchyhub.md")).toBe(false);
	});

	it("applies user-configured patterns", () => {
		const userPatterns = ["scratch-*", "*-draft.md"];
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/scratch-123.md", userPatterns)).toBe(true);
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/newsletter-draft.md", userPatterns)).toBe(true);
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/2026-03-31.md", userPatterns)).toBe(false);
	});

	it("combines built-in and user patterns", () => {
		const userPatterns = ["custom-ignore.md"];
		// Built-in still works
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/MEMORY.backup-2026-04-01.md", userPatterns)).toBe(true);
		// User pattern also works
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/custom-ignore.md", userPatterns)).toBe(true);
		// Non-matching still passes through
		expect(shouldExcludeFromIngestion("/home/user/.agents/memory/2026-03-31.md", userPatterns)).toBe(false);
	});
});
