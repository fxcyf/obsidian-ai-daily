import { describe, expect, it } from "vitest";
import { shouldShowChatMoreButton } from "./chat-view";

describe("shouldShowChatMoreButton", () => {
	it("shows menu for a harness context before the first message is sent", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: false,
				hasHarnessContext: true,
			})
		).toBe(true);
	});

	it("shows menu for existing conversations", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 1,
				hasSession: false,
				hasHarnessContext: false,
			})
		).toBe(true);
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: true,
				hasHarnessContext: false,
			})
		).toBe(true);
	});

	it("hides menu on the welcome screen without active conversation state", () => {
		expect(
			shouldShowChatMoreButton({
				messageCount: 0,
				hasSession: false,
				hasHarnessContext: false,
			})
		).toBe(false);
	});
});
