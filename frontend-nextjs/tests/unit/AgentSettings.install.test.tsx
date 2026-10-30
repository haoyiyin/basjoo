// @ts-nocheck
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentSettings from '../../src/views/AgentSettings';
import { api } from '../../src/services/api';

/**
 * #40 — the install experience.
 *
 * The dashboard deliberately runs on `http://localhost:3000` in these tests.
 * Before this issue the snippet was composed from `window.location.origin`, so a
 * dashboard opened locally handed out a `localhost` embed code. The snippet is
 * now built from the origin the SERVER reports.
 */

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
      params?.paths ? `${key}: ${params.paths}` : key,
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
  allowed_widget_origins: ['https://shop.example.com'],
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
  display_mode: 'bubble',
  excluded_paths: ['^/admin'],
  starters: [],
  widget_cards: [],
  traffic_percentage: 100,
};

function renderAgentSettings(initialEntry = '/agents/agt_1/settings/agent') {
  const router = createMemoryRouter(
    [{ path: '/agents/:agentId/settings/agent', element: <AgentSettings /> }],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  // The browser the operator is using to read the dashboard. It is localhost on
  // purpose — that is the environment the old code got wrong.
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000', href: 'http://localhost:3000/settings/agent' },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  mockedApi.getAgent.mockResolvedValue(agent as never);
  mockedApi.getDefaultAgent.mockResolvedValue(agent as never);
  mockedApi.updateAgent.mockResolvedValue(agent as never);
  mockedApi.listProcedures.mockResolvedValue({ items: [], total: 0 } as never);
  mockedApi.updateFixedFacts.mockResolvedValue({ fixed_facts: null } as never);
  // The server sits behind nginx on its public name.
  mockedApi.getPublicOrigin.mockResolvedValue('https://shop.example.com' as never);
});

describe('AgentSettings install surface (#40)', () => {
  it('copies exactly one script tag and it names the server origin, not localhost', async () => {
    renderAgentSettings();

    const snippet = await waitFor(() => {
      const node = screen.getByTestId('install-embed-code');
      expect(node.textContent).not.toBe('');
      return node.textContent as string;
    });

    // One tag, pointing at the public host — the localhost dashboard never leaks.
    expect(snippet).toBe(
      '<script src="https://shop.example.com/api/v1/agents/agt_1/embed.js" async></script>',
    );
    expect(snippet).not.toContain('localhost');
    expect(snippet.match(/<script/g)).toHaveLength(1);

    // `fireEvent`, not `userEvent`: userEvent installs its own clipboard stub,
    // and this assertion is about what the app hands to the real API.
    fireEvent.click(screen.getByRole('button', { name: 'install.copy' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // The copied text is the tag and nothing else.
    expect(writeText).toHaveBeenCalledWith(snippet);
    expect(writeText.mock.calls[0][0]).toBe(snippet);
  });

  it('reads the origin from the server endpoint, not from window.location', async () => {
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(mockedApi.getPublicOrigin).toHaveBeenCalledWith('agt_1');
    expect(screen.getByTestId('install-embed-code').textContent).toContain(
      'https://shop.example.com',
    );
  });

  it('shows a readable state and no localhost when the server origin is unknown', async () => {
    mockedApi.getPublicOrigin.mockResolvedValue(null as never);
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(screen.getByText('install.serverOriginUnknown')).toBeInTheDocument();
    expect(screen.getByTestId('install-embed-code').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'install.copy' })).toBeDisabled();
  });

  it('warns about a loopback origin but still lets the operator copy it', async () => {
    // The failing deployment from #40: no proxy, no PUBLIC_BASE_URL, so the
    // server answers with its own loopback address.
    mockedApi.getPublicOrigin.mockResolvedValue('http://127.0.0.1:8000' as never);
    renderAgentSettings();

    const snippet = await waitFor(() => {
      const node = screen.getByTestId('install-embed-code');
      expect(node.textContent).not.toBe('');
      return node.textContent as string;
    });

    // The note names the fix, and the copy is NOT blocked by it.
    expect(screen.getByTestId('install-loopback-warning')).toHaveTextContent(
      'install.loopbackOriginHint',
    );
    expect(screen.getByRole('button', { name: 'install.copy' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'install.copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(snippet);
  });

  it('says nothing about loopback when the server answers with a public host', async () => {
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(screen.queryByTestId('install-loopback-warning')).not.toBeInTheDocument();
  });

  it('renders the stored excluded paths and saves them as a list', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('install-excluded-paths')).toHaveValue('^/admin');

    await user.type(screen.getByTestId('install-excluded-paths'), '\n^/checkout$');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() =>
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({ excluded_paths: ['^/admin', '^/checkout$'] }),
      ),
    );
  });

  it('blocks the save and reports an excluded path that will not compile', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());

    fireEvent.change(screen.getByTestId('install-excluded-paths'), {
      target: { value: '^/admin\n([' },
    });
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    expect(mockedApi.updateAgent).not.toHaveBeenCalled();
    expect(screen.getByText('install.excludedPathsInvalid: ([')).toBeInTheDocument();
  });

  it('edits cards and starters as repeatable rows and saves both', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    // Nothing stored -> the empty state, not a phantom row.
    expect(screen.getByTestId('install-cards-empty')).toBeInTheDocument();
    expect(screen.getByTestId('install-starters-empty')).toBeInTheDocument();

    await user.click(screen.getByTestId('install-cards-add'));
    await user.type(screen.getByLabelText('install.cardHeading 1'), 'Shipping');
    await user.type(screen.getByLabelText('install.cardText 1'), 'Where is my order?');
    await user.type(screen.getByLabelText('install.cardAction 1'), 'Where is my order?');

    await user.click(screen.getByTestId('install-starters-add'));
    await user.type(screen.getByLabelText('install.starterLabel 1'), 'See pricing');
    await user.type(screen.getByLabelText('install.starterValue 1'), 'What does it cost?');
    await user.type(screen.getByLabelText('install.starterPath 1'), '^/pricing$');

    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() =>
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({
          widget_cards: [
            {
              heading: 'Shipping',
              text: 'Where is my order?',
              chat: 'Where is my order?',
              logo: undefined,
            },
          ],
          starters: [
            {
              label: 'See pricing',
              action: 'message',
              value: 'What does it cost?',
              path: '^/pricing$',
            },
          ],
        }),
      ),
    );
  });

  it('removes a starter row', async () => {
    mockedApi.getAgent.mockResolvedValue({
      ...agent,
      starters: [
        { label: 'One', action: 'message', value: 'One' },
        { label: 'Two', action: 'link', value: 'https://shop.example.com/pay' },
      ],
    } as never);
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    expect(screen.getByLabelText('install.starterLabel 1')).toHaveValue('One');
    expect(screen.getByLabelText('install.starterLabel 2')).toHaveValue('Two');

    await user.click(screen.getAllByRole('button', { name: 'install.startersRemove' })[0]);

    expect(screen.queryByLabelText('install.starterLabel 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('install.starterLabel 1')).toHaveValue('Two');
  });

  it('offers the inline container selector only for the non-bubble modes', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    // bubble (the default) has no container input.
    expect(screen.queryByLabelText('install.inlineContainer')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('install-display-mode'), 'inline');
    expect(screen.getByLabelText('install.inlineContainer')).toBeInTheDocument();

    await user.type(screen.getByLabelText('install.inlineContainer'), '#help-panel');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() =>
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({
          display_mode: 'inline',
          inline_container: '#help-panel',
        }),
      ),
    );
  });

  it('saves the rollout percentage', async () => {
    const user = userEvent.setup();
    renderAgentSettings();

    await waitFor(() => expect(screen.queryByText('status.loading')).not.toBeInTheDocument());
    const traffic = screen.getByTestId('install-traffic');
    expect(traffic).toHaveValue(100);

    await user.clear(traffic);
    await user.type(traffic, '25');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));

    await waitFor(() =>
      expect(mockedApi.updateAgent).toHaveBeenCalledWith(
        'agt_1',
        expect.objectContaining({ traffic_percentage: 25 }),
      ),
    );
  });
});
