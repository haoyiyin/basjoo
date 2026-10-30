// @ts-nocheck
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // #39: fixed facts and procedures are their own endpoints, not agent PATCH.
    updateFixedFacts: vi.fn(),
    listProcedures: vi.fn(),
    createProcedure: vi.fn(),
    updateProcedure: vi.fn(),
    deleteProcedure: vi.fn(),
    // #40: the embed snippet's origin comes from the server, never from
    // `window.location.origin`.
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
  embedding_model: 'jina-embeddings-v3',
  top_k: 8,
  similarity_threshold: 0.01,
  enable_context: true,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  rate_limit_per_minute: 10,
  restricted_reply: 'Custom restricted message',
};

function renderAgentSettings(initialEntry = '/agents/agt_1/settings/agent') {
  const router = createMemoryRouter(
    [{ path: '/agents/:agentId/settings/agent', element: <AgentSettings /> }],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getAgent.mockResolvedValue(agent as never);
  mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
  mockedApi.updateAgent.mockResolvedValue(agent as never);
  mockedApi.listProcedures.mockResolvedValue({ items: [], total: 0 } as never);
  mockedApi.updateFixedFacts.mockResolvedValue({ fixed_facts: null } as never);
  // A dashboard opened on http://localhost:3000 must still hand out the public
  // host: the origin is the server's answer, not the browser's.
  mockedApi.getPublicOrigin.mockResolvedValue('https://api.example.com' as never);
});

describe('AgentSettings', () => {
  it('loads the route agent and renders saved widget settings', async () => {
    renderAgentSettings();

    await waitFor(() => expect(mockedApi.getAgent).toHaveBeenCalledWith('agt_1'));
    // Wait for loading state to complete before assertions
    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'navigation.agentSettings' })).toBeInTheDocument();
    expect(screen.getByLabelText('labels.widgetTitle')).toHaveValue('Helpdesk');
    expect(screen.getByLabelText('labels.themeColor')).toHaveValue('#00aaff');
    expect(screen.getByLabelText('labels.welcomeMessage')).toHaveValue('Hello there');
    expect(screen.getByLabelText('labels.historyRetention')).toHaveValue(30);
    expect(screen.getByLabelText('labels.embedWhitelist')).toHaveValue('https://example.com');
    // #40: one script tag pointing at the server-rendered loader on the public host.
    expect(screen.getByTestId('install-embed-code').textContent).toBe(
      '<script src="https://api.example.com/api/v1/agents/agt_1/embed.js" async></script>',
    );
  });

  it('blocks save and shows invalid origin message for malformed whitelist entries', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    const origins = await screen.findByLabelText('labels.embedWhitelist');
    await user.clear(origins);
    await user.type(origins, 'example.com');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    expect(mockedApi.updateAgent).not.toHaveBeenCalled();
    expect(screen.getByText('labels.embedWhitelistInvalid: example.com')).toBeInTheDocument();
  });

  it('saves normalized widget settings', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await user.clear(await screen.findByLabelText('labels.widgetTitle'));
    await user.type(screen.getByLabelText('labels.widgetTitle'), 'New title');
    await user.clear(screen.getByLabelText('labels.embedWhitelist'));
    await user.type(screen.getByLabelText('labels.embedWhitelist'), 'HTTPS://Example.COM/path');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith('agt_1', {
        widget_title: 'New title',
        widget_color: '#00aaff',
        welcome_message: 'Hello there',
        history_days: 30,
        allowed_widget_origins: ['https://example.com'],
        rate_limit_per_minute: 10,
        restricted_reply: 'Custom restricted message',
        // #43: business hours ride along on the same save. #64 removed
        // `escalation_rules`, so the payload must no longer carry it at all —
        // `toEqual` here is exact, which is the assertion.
        business_hours: null,
        away_message: null,
        // #40: the install surface rides the same PATCH.
        display_mode: 'bubble',
        inline_container: null,
        excluded_paths: [],
        traffic_percentage: 100,
        starters: [],
        widget_cards: [],
        // #47: an empty webhook URL means "no endpoint"; the secret field is
        // omitted so an untouched signing secret survives the save.
        webhook_url: null,
      });
    });
  });

  // #47: the endpoint is editable, the secret is write-only and masked.
  it('edits the webhook endpoint and never reads the stored secret back', async () => {
    const user = userEvent.setup();
    mockedApi.getAgent.mockResolvedValue({
      ...agent,
      webhook_url: 'https://hooks.example.com/basjoo',
      webhook_secret_set: true,
    } as never);
    renderAgentSettings();

    const urlInput = await screen.findByLabelText('webhooks.urlLabel');
    expect(urlInput).toHaveValue('https://hooks.example.com/basjoo');

    const secretInput = screen.getByLabelText('webhooks.secretLabel');
    // The secret is never in the payload, so the field starts empty and shows
    // the masked placeholder instead of a value.
    expect(secretInput).toHaveValue('');
    expect(secretInput).toHaveAttribute('type', 'password');
    expect(secretInput).toHaveAttribute(
      'placeholder',
      'webhooks.secretMasked',
    );

    await user.clear(urlInput);
    await user.type(urlInput, 'https://hooks.example.com/v2');
    await user.clear(secretInput);
    await user.type(secretInput, 'rotated-secret');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({
          webhook_url: 'https://hooks.example.com/v2',
          webhook_secret: 'rotated-secret',
        }),
      );
    });
  });

  it('saves a business-hours schedule and has no escalation-rules field (#43, #64)', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    // Wait for the agent to hydrate before asserting on the form.
    await screen.findByTestId('agent-business-hours-card');

    // #64 inverted this half of the test: the 升级规则 textarea is gone, so the
    // label that used to be typed into no longer exists anywhere on the page.
    expect(screen.queryByLabelText('escalation.label')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-escalation-textarea')).not.toBeInTheDocument();

    // No timezone selected yet: the schedule editor stays inert.
    expect(screen.getByTestId('business-hours-empty')).toBeInTheDocument();
    expect(screen.getByTestId('business-hours-add')).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('businessHours.timezone'), 'Asia/Shanghai');
    await user.click(screen.getByTestId('business-hours-add'));

    expect(screen.getByTestId('business-hours-ranges')).toBeInTheDocument();

    // Defaults are 09:00-18:00 on Monday (day 0).
    expect(screen.getByLabelText('businessHours.start 1')).toHaveValue('09:00');
    expect(screen.getByLabelText('businessHours.end 1')).toHaveValue('18:00');

    // A `time` input is replaced atomically — typing character by character
    // would drive the editor through meaningless intermediate values.
    fireEvent.change(screen.getByLabelText('businessHours.end 1'), {
      target: { value: '22:30' },
    });
    await user.type(screen.getByLabelText('businessHours.awayMessage'), 'We are away.');

    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({
          business_hours: {
            timezone: 'Asia/Shanghai',
            schedule: [{ day: 0, start: 540, end: 1350 }],
          },
          away_message: 'We are away.',
        }),
      );
    });
  });

  it('round-trips a stored schedule into the editor (#43)', async () => {
    // #64: a stale `escalation_rules` value in the payload must be ignored —
    // there is no field left to hydrate it into, and it must not appear on the
    // page as text either.
    mockedApi.getAgent.mockResolvedValue({
      ...agent,
      escalation_rules: 'Always escalate refunds',
      business_hours: {
        timezone: 'Europe/London',
        schedule: [{ day: 5, start: 1320, end: 120 }],
      },
      away_message: 'Back Monday.',
    } as never);
    renderAgentSettings();

    expect(await screen.findByLabelText('businessHours.timezone')).toHaveValue(
      'Europe/London',
    );
    expect(screen.queryByLabelText('escalation.label')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Always escalate refunds'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('businessHours.timezone')).toHaveValue('Europe/London');
    // 22:00 -> 02:00 wraps past midnight and is stored as-is.
    expect(screen.getByLabelText('businessHours.start 1')).toHaveValue('22:00');
    expect(screen.getByLabelText('businessHours.end 1')).toHaveValue('02:00');
    expect(screen.getByLabelText('businessHours.awayMessage')).toHaveValue('Back Monday.');
  });

  it('renders rate_limit_per_minute from agent fixture and allows changing it', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    
    const rateLimitInput = screen.getByLabelText('labels.perMinuteLimit');
    expect(rateLimitInput).toHaveValue(10);

    await user.clear(rateLimitInput);
    await user.type(rateLimitInput, '20');
    expect(rateLimitInput).toHaveValue(20);

    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({ rate_limit_per_minute: 20 }),
      );
    });
  });

  it('renders restricted_reply from agent fixture and allows changing it', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    
    const restrictedReplyInput = screen.getByLabelText('labels.restrictedReplyLabel');
    expect(restrictedReplyInput).toHaveValue('Custom restricted message');

    await user.clear(restrictedReplyInput);
    await user.type(restrictedReplyInput, 'New restricted reply');
    expect(restrictedReplyInput).toHaveValue('New restricted reply');

    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({ restricted_reply: 'New restricted reply' }),
      );
    });
  });

  it('renders the fixed-facts card and saves through its own endpoint', async () => {
    const user = userEvent.setup();
    mockedApi.getAgent.mockResolvedValue({
      ...agent,
      fixed_facts: 'Address: 3F, 100 Hengshan Road.',
    } as never);
    mockedApi.updateFixedFacts.mockResolvedValue({
      fixed_facts: 'Address: 3F, 100 Hengshan Road.\n\nBooking: https://b.example.com',
    } as never);

    renderAgentSettings();

    const textarea = await screen.findByLabelText('fixedFacts.label');
    expect(textarea).toHaveValue('Address: 3F, 100 Hengshan Road.');

    await user.type(textarea, '\n\nBooking: https://b.example.com');
    await user.click(screen.getByRole('button', { name: 'fixedFacts.save' }));

    await waitFor(() => {
      expect(mockedApi.updateFixedFacts).toHaveBeenCalledWith(
        'agt_1',
        'Address: 3F, 100 Hengshan Road.\n\nBooking: https://b.example.com',
      );
    });
    // The general agent PATCH must not carry fixed facts.
    expect(mockedApi.updateAgent).not.toHaveBeenCalled();
  });

  it('mounts the procedure editor for the route agent', async () => {
    renderAgentSettings();

    await waitFor(() =>
      expect(mockedApi.listProcedures).toHaveBeenCalledWith('agt_1'),
    );
    expect(screen.getByTestId('agent-procedures-card')).toBeInTheDocument();
  });

  it('allows setting rate_limit_per_minute to 0 (no limit)', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    
    const rateLimitInput = screen.getByLabelText('labels.perMinuteLimit');
    expect(rateLimitInput).toHaveValue(10);

    await user.clear(rateLimitInput);
    await user.type(rateLimitInput, '0');
    expect(rateLimitInput).toHaveValue(0);

    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() => {
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({ rate_limit_per_minute: 0 }),
      );
    });
  });
});