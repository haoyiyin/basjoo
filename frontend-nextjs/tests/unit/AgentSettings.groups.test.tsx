// @ts-nocheck
// @vitest-environment jsdom
/**
 * #63 / D1 — the settings page is grouped by what a thing does, in prompt order.
 *
 * The page used to be one flat run of cards, so 固定事实 sat next to 业务时间 and
 * the install surface sat next to the model config. D1 fixes four groups,
 * mirroring `_build_system_content`:
 *
 *   定义 AI (人设, 服务流程) → 给它资料 (知识库 Q&A, 固定事实)
 *   → 何时转人工 (业务时间) → 把机器人放到网站上 (安装方式)
 *
 * These are structural assertions (order + presence), not a copy snapshot: the
 * copy lives in the locale files and is checked there.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentSettings from '../../src/views/AgentSettings';
import { api } from '../../src/services/api';

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
		updateFixedFacts: vi.fn(),
		listProcedures: vi.fn(),
		createProcedure: vi.fn(),
		updateProcedure: vi.fn(),
		deleteProcedure: vi.fn(),
		getPublicOrigin: vi.fn(),
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
	widget_color: '#00aaff',
	welcome_message: 'Hello there',
	history_days: 30,
	allowed_widget_origins: ['https://example.com'],
	system_prompt: 'prompt',
	model: 'deepseek-chat',
	temperature: 0.7,
	max_tokens: 1024,
	top_k: 8,
	similarity_threshold: 0.01,
	enable_context: true,
	is_active: true,
	created_at: '2026-01-01T00:00:00Z',
	rate_limit_per_minute: 10,
	restricted_reply: 'Custom restricted message',
	fixed_facts: '',
	business_hours: null,
	away_message: null,
	display_mode: 'bubble',
	inline_container: null,
	excluded_paths: [],
	traffic_percentage: 100,
	starters: [],
	widget_cards: [],
	webhook_url: null,
	webhook_secret_set: false,
};

function renderAgentSettings() {
	const router = createMemoryRouter(
		[{ path: '/agents/:agentId/settings/agent', element: <AgentSettings /> }],
		{ initialEntries: ['/agents/agt_1/settings/agent'] },
	);
	render(<RouterProvider router={router} />);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedApi.getAgent.mockResolvedValue(agent as never);
	mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
	mockedApi.updateAgent.mockResolvedValue(agent as never);
	mockedApi.updateFixedFacts.mockResolvedValue(agent as never);
	mockedApi.listProcedures.mockResolvedValue({ items: [], total: 0 } as never);
	mockedApi.getPublicOrigin.mockResolvedValue('https://api.example.com' as never);
});

describe('AgentSettings grouping (#63 / D1)', () => {
	it('groups the page in prompt-assembly order', async () => {
		renderAgentSettings();

		const defineAi = await screen.findByTestId('settings-group-define-ai');
		const materials = screen.getByTestId('settings-group-materials');
		const handoff = screen.getByTestId('settings-group-handoff');
		const install = screen.getByTestId('settings-group-install');

		// `compareDocumentPosition` is the DOM's own "what comes first" answer, so
		// this pins real render order rather than the order of the source lines.
		const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
		expect(defineAi.compareDocumentPosition(materials) & FOLLOWING).toBeTruthy();
		expect(materials.compareDocumentPosition(handoff) & FOLLOWING).toBeTruthy();
		expect(handoff.compareDocumentPosition(install) & FOLLOWING).toBeTruthy();

		// Outbound webhooks are neither prompt material nor install surface: they
		// trail the whole page in their own group.
		expect(
			install.compareDocumentPosition(
				screen.getByTestId('settings-group-outbound'),
			) & FOLLOWING,
		).toBeTruthy();
	});

	it('places fixed facts inside 给它资料 and business hours inside 何时转人工', async () => {
		renderAgentSettings();

		const materials = await screen.findByTestId('settings-group-materials');
		const fixedFacts = screen.getByTestId('agent-fixed-facts-card');
		const handoff = screen.getByTestId('settings-group-handoff');
		const businessHours = screen.getByTestId('agent-business-hours-card');

		// Fixed facts: after the 给它资料 heading, before the 何时转人工 heading.
		expect(
			materials.compareDocumentPosition(fixedFacts) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			fixedFacts.compareDocumentPosition(handoff) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		// Business hours: inside the handoff group, before the install heading.
		expect(
			handoff.compareDocumentPosition(businessHours) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			businessHours.compareDocumentPosition(
				screen.getByTestId('settings-group-install'),
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it('carries a "when this takes effect" hint on every grouped field', async () => {
		renderAgentSettings();

		await screen.findByTestId('agent-settings-page');

		for (const testId of [
			'procedures-when-hint',
			'fixed-facts-when-hint',
			'business-hours-when-hint',
			'away-message-when-hint',
			'widget-appearance-when-hint',
			'embed-whitelist-when-hint',
			'install-display-mode-when-hint',
			'install-excluded-paths-when-hint',
			'install-traffic-when-hint',
			'install-cards-when-hint',
			'install-starters-when-hint',
		]) {
			expect(screen.getByTestId(testId), testId).toBeInTheDocument();
		}
	});

	it('points 定义 AI at the Playground pane that owns the persona', async () => {
		renderAgentSettings();

		await screen.findByTestId('settings-group-define-ai');
		expect(
			screen.getByTestId('settings-group-define-ai-persona-pointer'),
		).toHaveTextContent('settingsGroups.defineAiPersonaPointer');
	});

	it('states the fixed-facts-vs-Q&A contrast under 固定事实', async () => {
		renderAgentSettings();

		const contrast = await screen.findByTestId('fixed-facts-vs-qa');
		expect(contrast).toHaveTextContent('fixedFacts.vsQaHint');
	});

	it('keeps the install description and the per-mode difference lines', async () => {
		renderAgentSettings();

		const installGroup = await screen.findByTestId('settings-group-install');
		expect(installGroup).toHaveTextContent('settingsGroups.install');

		// The three modes each get their own one-line difference, so the select
		// can be understood without switching it.
		const diff = screen.getByTestId('install-display-mode-diff');
		expect(diff).toBeInTheDocument();
		expect(screen.getByText('install.displayModeDiffBubble')).toBeInTheDocument();
		expect(screen.getByText('install.displayModeDiffInline')).toBeInTheDocument();
		expect(screen.getByText('install.displayModeDiffIframe')).toBeInTheDocument();
	});
});
