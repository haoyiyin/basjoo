// @ts-nocheck
// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText(/sdk\.js\?agent_id=agt_1/)).toBeInTheDocument();
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
      });
    });
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