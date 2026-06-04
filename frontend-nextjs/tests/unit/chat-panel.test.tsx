/**
 * Unit tests for ChatPanel component - selector regression tests.
 *
 * Run with: vitest run tests/unit/chat-panel.test.tsx
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "../../src/components/ChatPanel";
import type { Agent } from "../../src/components/ChatPanel";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const mockAgent: Agent = {
  id: "test-agent-123",
  name: "Test Agent",
  model: "gpt-4",
  temperature: 0.7,
  max_tokens: 1024,
  system_prompt: "You are a helpful assistant.",
};

describe("ChatPanel Component", () => {
  it("renders chat input with data-testid='chat-message-input'", () => {
    render(
      <ChatPanel
        messages={[]}
        input=""
        isLoading={false}
        isSettingsSaving={false}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput).toBeInTheDocument();
    expect(chatInput).toBeVisible();
  });

  it("chat input remains visible textbox for user typing", () => {
    render(
      <ChatPanel
        messages={[]}
        input=""
        isLoading={false}
        isSettingsSaving={false}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput.tagName.toLowerCase()).toBe("input");
    expect(chatInput).toHaveAttribute("type", "text");
  });

  it("chat input is present even when disabled during loading", () => {
    render(
      <ChatPanel
        messages={[]}
        input="test message"
        isLoading={true}
        isSettingsSaving={false}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput).toBeInTheDocument();
    expect(chatInput).toBeDisabled();
  });

  it("chat input is present even when settings are saving", () => {
    render(
      <ChatPanel
        messages={[]}
        input=""
        isLoading={false}
        isSettingsSaving={true}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput).toBeInTheDocument();
    expect(chatInput).toBeDisabled();
  });

  it("chat input displays placeholder from i18n", () => {
    render(
      <ChatPanel
        messages={[]}
        input=""
        isLoading={false}
        isSettingsSaving={false}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput).toHaveAttribute("aria-label");
  });
});

describe("ChatPanel Selectors - E2E Regression Prevention", () => {
  it("exposes stable selector for Playwright E2E tests", () => {
    // This test ensures data-testid="chat-message-input" is always present
    // Breaking this will cause E2E failures in playground-streaming.spec.ts
    render(
      <ChatPanel
        messages={[]}
        input=""
        isLoading={false}
        isSettingsSaving={false}
        agent={mockAgent}
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onClearChat={() => {}}
      />
    );

    // Playwright uses: page.getByTestId("chat-message-input")
    // This must resolve to a visible, enabled or disabled input element
    const chatInput = screen.getByTestId("chat-message-input");
    expect(chatInput).toBeInTheDocument();
    expect(chatInput.tagName.toLowerCase()).toBe("input");
  });
});
