// @ts-nocheck
// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSettings from '../../src/views/AccountSettings';
import { parseErrorResponse } from '../../src/services/api';

const { changeLanguage } = vi.hoisted(() => ({ changeLanguage: vi.fn() }));

vi.mock('../../src/components/AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../src/hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    admin: { id: 1, name: 'Owner', email: 'owner@example.com', role: 'super_admin' },
    token: 'jwt-test-token',
    logout: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', changeLanguage },
  }),
}));

vi.mock('../../src/services/api', () => ({
  api: {},
  parseErrorResponse: vi.fn(async () => 'Current password is incorrect'),
}));

const mockedParseErrorResponse = vi.mocked(parseErrorResponse);

function renderAccountSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings/account']}>
      <AccountSettings />
    </MemoryRouter>,
  );
}

async function fillPasswords(user, current, next, confirm) {
  await user.type(await screen.findByLabelText('settings.account.currentPassword'), current);
  await user.type(screen.getByLabelText('settings.account.newPassword'), next);
  await user.type(screen.getByLabelText('settings.account.confirmPassword'), confirm);
  await user.click(screen.getByRole('button', { name: 'settings.account.savePassword' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
});

describe('AccountSettings', () => {
  it('renders the account info block from the auth context', () => {
    renderAccountSettings();

    expect(screen.getByRole('heading', { name: 'settings.account.title' })).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('switches the interface language through i18n', async () => {
    const user = userEvent.setup();
    renderAccountSettings();

    await user.click(screen.getByRole('button', { name: 'settings.account.languageEn' }));

    expect(changeLanguage).toHaveBeenCalledWith('en-US');
  });

  it('posts the new password with the bearer token and clears the form on success', async () => {
    const user = userEvent.setup();
    renderAccountSettings();

    await fillPasswords(user, 'old-secret', 'new-secret', 'new-secret');

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/me/password');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer jwt-test-token');
    expect(JSON.parse(init.body)).toEqual({
      current_password: 'old-secret',
      new_password: 'new-secret',
    });

    expect(await screen.findByText('settings.account.passwordChanged')).toBeInTheDocument();
    expect(screen.getByLabelText('settings.account.currentPassword')).toHaveValue('');
    expect(screen.getByLabelText('settings.account.newPassword')).toHaveValue('');
    expect(screen.getByLabelText('settings.account.confirmPassword')).toHaveValue('');
  });

  it('surfaces the backend detail when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'Current password is incorrect' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderAccountSettings();

    await fillPasswords(user, 'wrong-old', 'new-secret', 'new-secret');

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(mockedParseErrorResponse).toHaveBeenCalledTimes(1);
  });

  it('blocks the request when the confirmation does not match', async () => {
    const user = userEvent.setup();
    renderAccountSettings();

    await fillPasswords(user, 'old-secret', 'new-secret', 'other-secret');

    expect(screen.getByText('settings.account.passwordMismatch')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks the request when the new password is shorter than 8 characters', async () => {
    const user = userEvent.setup();
    renderAccountSettings();

    await fillPasswords(user, 'old-secret', 'short', 'short');

    expect(screen.getByText('settings.account.passwordTooShort')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
