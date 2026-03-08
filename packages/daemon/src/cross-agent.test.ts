import { afterEach, describe, expect, it, mock } from "bun:test";
import {
	createAgentMessage,
	listAgentMessages,
	listAgentPresence,
	relayMessageViaAcp,
	removeAgentPresence,
	resetCrossAgentStateForTest,
	subscribeCrossAgentEvents,
	touchAgentPresence,
	upsertAgentPresence,
} from "./cross-agent";

afterEach(() => {
	resetCrossAgentStateForTest();
});

describe("cross-agent presence", () => {
	it("upserts and lists peer sessions while excluding self", () => {
		upsertAgentPresence({
			sessionKey: "sess-a",
			agentId: "alpha",
			harness: "openclaw",
			project: "/repo",
		});
		upsertAgentPresence({
			sessionKey: "sess-b",
			agentId: "beta",
			harness: "opencode",
			project: "/repo",
		});

		const peers = listAgentPresence({
			agentId: "alpha",
			sessionKey: "sess-a",
			includeSelf: false,
		});

		expect(peers.length).toBe(1);
		expect(peers[0]?.agentId).toBe("beta");
		expect(peers[0]?.sessionKey).toBe("sess-b");
	});

	it("touches and removes session presence", () => {
		upsertAgentPresence({
			sessionKey: "sess-x",
			agentId: "alpha",
			harness: "openclaw",
		});

		const touched = touchAgentPresence("sess-x");
		expect(touched).not.toBeNull();
		expect(touched?.agentId).toBe("alpha");

		const removed = removeAgentPresence("sess-x");
		expect(removed).toBe(true);
		expect(listAgentPresence().length).toBe(0);
	});
});

describe("cross-agent messages", () => {
	it("stores direct messages and lists inbox for recipient", () => {
		upsertAgentPresence({
			sessionKey: "sess-a",
			agentId: "alpha",
			harness: "openclaw",
		});
		upsertAgentPresence({
			sessionKey: "sess-b",
			agentId: "beta",
			harness: "opencode",
		});

		createAgentMessage({
			fromAgentId: "alpha",
			fromSessionKey: "sess-a",
			toAgentId: "beta",
			content: "Need help with migration rollout plan.",
			type: "assist_request",
		});

		const inbox = listAgentMessages({ agentId: "beta" });
		expect(inbox.length).toBe(1);
		expect(inbox[0]?.type).toBe("assist_request");
		expect(inbox[0]?.content).toContain("migration rollout");
	});

	it("includes broadcast messages in recipient inbox", () => {
		createAgentMessage({
			fromAgentId: "alpha",
			content: "CI is currently red on main.",
			broadcast: true,
			type: "decision_update",
		});

		const inbox = listAgentMessages({ agentId: "beta" });
		expect(inbox.length).toBe(1);
		expect(inbox[0]?.broadcast).toBe(true);
	});

	it("emits events for presence and messages", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeCrossAgentEvents((event) => {
			seen.push(event.type);
		});

		upsertAgentPresence({
			sessionKey: "sess-a",
			agentId: "alpha",
			harness: "openclaw",
		});
		createAgentMessage({
			fromAgentId: "alpha",
			toAgentId: "beta",
			content: "status?",
		});

		unsubscribe();
		expect(seen).toEqual(["presence", "message"]);
	});
});

describe("ACP relay", () => {
	it("posts a run request and returns run id", async () => {
		const originalFetch = globalThis.fetch;
		const capture: { url?: string; body?: string } = {};

		globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
			capture.url = typeof input === "string" ? input : input.toString();
			capture.body = typeof init?.body === "string" ? init.body : "";
			return new Response(JSON.stringify({ run_id: "run-123", status: "running" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const result = await relayMessageViaAcp({
			baseUrl: "http://localhost:9000/",
			targetAgentName: "helper-agent",
			content: "Can you verify this deployment plan?",
			fromAgentId: "alpha",
			fromSessionKey: "sess-a",
		});

		globalThis.fetch = originalFetch;

		expect(capture.url).toBe("http://localhost:9000/runs");
		const body = JSON.parse(capture.body ?? "{}");
		expect(body.agent_name).toBe("helper-agent");
		expect(body.input?.[0]?.parts?.[0]?.content).toContain("deployment plan");
		expect(result.ok).toBe(true);
		expect(result.runId).toBe("run-123");
	});
});
