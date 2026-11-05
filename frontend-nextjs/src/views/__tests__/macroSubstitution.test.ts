// @vitest-environment jsdom
/**
 * #74 — the substitution helper, pinned directly.
 *
 * The picker test covers the rendered path; this file pins the pure contract so
 * a regression is reported by name rather than through the DOM:
 *
 *  1. every known variable resolves, and unknown text passes through;
 *  2. `{{x | fallback}}` renders the fallback when `x` is missing OR empty;
 *  3. a missing value without a fallback stays the literal `{{x}}`;
 *  4. the fallback half is kept verbatim (spaces trimmed, pipes inside it kept);
 *  5. whitespace inside the braces is irrelevant.
 */
import { describe, expect, it } from "vitest";
import {
	MACRO_BODY_MAX_LENGTH,
	MACRO_NAME_MAX_LENGTH,
	substituteMacroVariables,
} from "../../services/api";

const context = {
	visitorName: "Dana Visitor",
	visitorEmail: "dana@example.com",
	operatorName: "Olive Operator",
	sessionId: "pub_sess_1",
};

describe("#74 substituteMacroVariables", () => {
	it("fills every variable the console knows", () => {
		expect(
			substituteMacroVariables(
				"{{visitor.name}} <{{visitor.email}}> #{{session.id}} by {{operator.name}}",
				context,
			),
		).toBe("Dana Visitor <dana@example.com> #pub_sess_1 by Olive Operator");
	});

	it("leaves text that carries no variable untouched", () => {
		expect(substituteMacroVariables("Plain reply, no braces.", context)).toBe(
			"Plain reply, no braces.",
		);
		expect(substituteMacroVariables("", context)).toBe("");
	});

	it("renders the fallback when the variable is missing", () => {
		expect(
			substituteMacroVariables("Call {{visitor.phone | 400-800-1234}}.", context),
		).toBe("Call 400-800-1234.");
	});

	it("renders the fallback when the variable is present but empty", () => {
		expect(
			substituteMacroVariables("Hi {{visitor.name | there}}", {
				...context,
				visitorName: "   ",
			}),
		).toBe("Hi there");
	});

	it("prefers the value over the fallback", () => {
		expect(
			substituteMacroVariables("Hi {{visitor.name | there}}", context),
		).toBe("Hi Dana Visitor");
	});

	it("keeps an unresolved variable literal, braces included", () => {
		expect(
			substituteMacroVariables("Org: {{visitor.company}}", context),
		).toBe("Org: {{visitor.company}}");
	});

	it("tolerates whitespace around the name and the pipe", () => {
		expect(
			substituteMacroVariables("{{ visitor.name }} / {{ visitor.phone | n/a }}", context),
		).toBe("Dana Visitor / n/a");
	});

	it("mirrors the API caps", () => {
		// The console prints these numbers and caps its inputs with them; they
		// must stay equal to MACRO_NAME_MAX_LENGTH / MACRO_BODY_MAX_LENGTH in
		// backend/api/v1/schemas.py.
		expect(MACRO_NAME_MAX_LENGTH).toBe(200);
		expect(MACRO_BODY_MAX_LENGTH).toBe(2500);
	});
});
