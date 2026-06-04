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
      });
    });
  });
});