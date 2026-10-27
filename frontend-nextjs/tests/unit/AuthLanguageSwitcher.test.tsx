// @vitest-environment jsdom
/**
 * R4 — the auth language switcher shows two abbreviations and no label.
 *
 * The accessible name is the full language name, not the abbreviation, so the
 * assertion for `aria-label` is separate from the visible text.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { AuthLanguageSwitcher } from "../../src/components/AuthLanguageSwitcher";

const i18nState = vi.hoisted(() => ({
	language: "en-US",
	changeLanguage: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		// The old switcher printed this key; it must never reach the DOM again.
		t: (key: string) => key,
		i18n: i18nState,
	}),
}));

beforeEach(() => {
	i18nState.language = "en-US";
	i18nState.changeLanguage.mockClear();
});

function renderAt(pathname: string) {
	return render(
		<MemoryRouter initialEntries={[pathname]}>
			<AuthLanguageSwitcher />
		</MemoryRouter>,
	);
}

describe("Auth language switcher (R4)", () => {
	it("renders exactly the two abbreviations without a label", () => {
		const { container } = renderAt("/login");

		expect(container.textContent).toBe("ZHEN");
		expect(container.textContent).not.toMatch(/language/i);

		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(2);
		expect(buttons.map((button) => button.textContent)).toEqual(["ZH", "EN"]);
	});

	it("keeps the descriptive accessible names", () => {
		renderAt("/register");

		expect(screen.getByRole("button", { name: "简体中文" })).toHaveTextContent(
			"ZH",
		);
		expect(screen.getByRole("button", { name: "English" })).toHaveTextContent(
			"EN",
		);
	});

	it("marks the active language and switches on click", () => {
		renderAt("/login");

		const en = screen.getByRole("button", { name: "English" });
		const zh = screen.getByRole("button", { name: "简体中文" });
		expect(en).toHaveAttribute("aria-pressed", "true");
		expect(en).toHaveAttribute("data-active", "true");
		expect(zh).not.toHaveAttribute("data-active");

		zh.click();
		expect(i18nState.changeLanguage).toHaveBeenCalledWith("zh-CN");
	});

	it("stays out of the authenticated app", () => {
		const { container } = renderAt("/settings/account");
		expect(container).toBeEmptyDOMElement();
		cleanup();
	});
});
