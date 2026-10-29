// @vitest-environment jsdom
/**
 * Issue #48, acceptance item 5 — "Preview in AgentSettings matches the shipped
 * widget pixel-wise at the same width".
 *
 * The preview is not a screenshot: it is the shipped widget's markup order and
 * metrics, painted with the widget's own token mirror (`widget/src/theme.ts`,
 * which `widget/src/theme.test.ts` pins to `frontend-nextjs/src/index.css`).
 * These tests assert the three properties that make "what I picked" and "what
 * ships" impossible to diverge:
 *
 *   1. the preview shows the CURRENT form values (title, welcome message,
 *      accent) and updates as they are edited, without saving;
 *   2. it is decorative for assistive tech (`aria-hidden`);
 *   3. it cannot overflow: a 360px cap inside an `overflow: hidden` frame, and
 *      the frame is painted with the widget's tokens, not with console vars.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentSettings from '../../src/views/AgentSettings';
import { api } from '../../src/services/api';
import { THEMES } from '../../src/design/widgetTheme';

vi.mock('../../src/context/AuthContext', () => ({
	useAuth: () => ({
		admin: { id: 1, name: 'Owner', email: 'owner@example.com', role: 'super_admin' },
		logout: vi.fn(),
	}),
}));

vi.mock('../../src/hooks/useMediaQuery', () => ({
	useIsMobile: () => false,
}));

vi.mock('../../src/services/api', () => ({
	api: {
		getAgent: vi.fn(),
		getDefaultAgent: vi.fn(),
		updateAgent: vi.fn(),
	},
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params?.origins ? `${key}: ${params.origins}` : key,
	}),
}));

const mockedApi = vi.mocked(api);

const agent = {
	id: 'agt_1',
	name: 'Support Bot',
	widget_title: 'Helpdesk',
	widget_color: '#F9CA02',
	welcome_message: 'Hello there',
	history_days: 30,
	allowed_widget_origins: ['https://example.com'],
	system_prompt: 'prompt',
	model: 'deepseek-chat',
	temperature: 0.7,
	max_tokens: 1024,
	embedding_model: 'jina-embeddings-v3',
	top_k: 8,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	created_at: '2026-01-01T00:00:00Z',
	rate_limit_per_minute: 10,
	restricted_reply: 'Custom restricted message',
};

function renderAgentSettings() {
	const router = createMemoryRouter(
		[{ path: '/agents/:agentId/settings/agent', element: <AgentSettings /> }],
		{ initialEntries: ['/agents/agt_1/settings/agent'] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

/** The preview frame (the 360px box). */
function previewFrame(): HTMLElement {
	const frame = screen.getByTestId('widget-preview');
	expect(frame).toBeTruthy();
	return frame;
}

function previewHeader(): HTMLElement {
	const header = screen.getByTestId('widget-preview-header');
	expect(header).toBeTruthy();
	return header;
}

/**
 * The browser-normalised form of a declaration value.
 *
 * jsdom rewrites `hsl(40, 30%, 97.5%)` to `rgb(251, 249, 247)`, so a preview
 * that paints `tokens.surface` and a preview that paints a literal with the
 * same ink are indistinguishable by string comparison. Styling a detached
 * probe with the token and reading it back applies exactly the same
 * normalisation, so equality against the probe means "the preview used THIS
 * token value" — which is the property that matters.
 */
function normalized(
	property: 'background' | 'boxShadow' | 'fontFamily' | 'borderRadius',
	value: string,
): string {
	const probe = document.createElement('div');
	probe.style[property] = value;
	return probe.style[property];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agent as never);
	mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
	mockedApi.updateAgent.mockResolvedValue(agent as never);
	document.documentElement.dataset.theme = 'light';
});

afterEach(() => {
	delete document.documentElement.dataset.theme;
});

describe('AgentSettings — live widget preview', () => {
	it('renders the current widget title and welcome message', async () => {
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		// The saved title is the preview's header heading...
		expect(previewHeader().textContent).toContain('Helpdesk');
		// ...and the saved welcome message is the assistant bubble.
		expect(previewFrame().textContent).toContain('Hello there');
		// The sample user turn and composer come from i18n, never from the agent.
		expect(previewFrame().textContent).toContain(
			'settings.widgetPreview.sampleUserMessage',
		);
		expect(previewFrame().textContent).toContain(
			'settings.widgetPreview.samplePlaceholder',
		);
	});

	it('updates the previewed heading while the title input is edited, before saving', async () => {
		const user = userEvent.setup();
		renderAgentSettings();

		const titleInput = await screen.findByLabelText('labels.widgetTitle');
		await waitFor(() => expect(previewHeader().textContent).toContain('Helpdesk'));

		await user.clear(titleInput);
		await user.type(titleInput, 'Concierge');

		expect(previewHeader().textContent).toContain('Concierge');
		expect(previewHeader().textContent).not.toContain('Helpdesk');
		// Editing is a preview, not a save.
		expect(mockedApi.updateAgent).not.toHaveBeenCalled();
	});

	it('updates the previewed welcome bubble while the message textarea is edited', async () => {
		const user = userEvent.setup();
		renderAgentSettings();

		const welcome = await screen.findByLabelText('labels.welcomeMessage');
		await user.clear(welcome);
		await user.type(welcome, 'Ask me anything');

		expect(previewFrame().textContent).toContain('Ask me anything');
		expect(mockedApi.updateAgent).not.toHaveBeenCalled();
	});

	it('paints the header with the current widget_color form value', async () => {
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		// jsdom does not compute a gradient, so the assertion is on the inline
		// declaration the widget itself would emit: the operator's colour as the
		// first stop, its -20 ramp as the second.
		const background = previewHeader().style.background;
		expect(background).toContain('linear-gradient');
		expect(background).toContain('rgb(249, 202, 2)');

		const colourInput = screen.getByLabelText('labels.themeColor') as HTMLInputElement;
		fireEvent.input(colourInput, { target: { value: '#123456' } });

		await waitFor(() =>
			expect(previewHeader().style.background).toContain('rgb(18, 52, 86)'),
		);
	});

	it('is decorative for assistive technology', async () => {
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		expect(previewFrame().getAttribute('aria-hidden')).toBe('true');
		// The surrounding block is labelled, so the region is still discoverable.
		expect(screen.getByText('settings.widgetPreview.title')).toBeInTheDocument();
	});

	it('cannot overflow: a 360px cap inside an overflow-hidden frame', async () => {
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		const frame = previewFrame();
		expect(frame.style.width).toBe('360px');
		expect(frame.style.maxWidth).toBe('100%');
		expect(frame.style.overflow).toBe('hidden');
	});

	it('is painted from the widget token mirror, not from console vars', async () => {
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		const frame = previewFrame();
		const tokens = THEMES.light;

		// The frame is the widget's surface with the widget's large radius and
		// raised shadow — the exact values `createStyles()` emits.
		expect(frame.style.background).toBe(normalized('background', tokens.surface));
		expect(frame.style.borderRadius).toBe(tokens.radiusLg);
		expect(frame.style.boxShadow).toBe(normalized('boxShadow', tokens.shadow3));
		expect(frame.style.fontFamily).toBe(normalized('fontFamily', tokens.fontText));

		// The header uses the display face (Outfit) like `.basjoo-header-title`.
		const heading = previewHeader().firstElementChild as HTMLElement;
		expect(heading.style.fontFamily).toBe(normalized('fontFamily', tokens.fontDisplay));

		// ...and nothing in the preview falls back to a console custom property.
		expect(frame.outerHTML).not.toContain('var(--');
	});

	it('follows the console theme when data-theme is dark', async () => {
		document.documentElement.dataset.theme = 'dark';
		renderAgentSettings();

		await waitFor(() =>
			expect(screen.queryByText('status.loading')).not.toBeInTheDocument(),
		);

		expect(previewFrame().style.background).toBe(
			normalized('background', THEMES.dark.surface),
		);
		expect(previewFrame().style.boxShadow).toBe(
			normalized('boxShadow', THEMES.dark.shadow3),
		);
		// The two themes really do differ — a preview stuck on light would pass
		// the assertions above if both tokens normalised to the same ink.
		expect(THEMES.dark.surface).not.toBe(THEMES.light.surface);
	});
});
