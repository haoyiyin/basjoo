/**
 * The install snippet (#40).
 *
 * The old composer built a `/sdk.js?agent_id=…` URL from `window.location.origin`
 * whenever `VITE_API_BASE_URL` was empty — which is the default — so a dashboard
 * opened on `localhost` handed out a `localhost` embed code. The URL is now
 * server-rendered: `/api/v1/agents/{id}/embed.js` carries `api_base`, the origin
 * allowlist, the excluded paths and the display mode as baked constants, and it
 * derives its own origin from `PUBLIC_BASE_URL` / `X-Forwarded-Host` (the same
 * rule as `/config:public`). The browser only ever concatenates the server's
 * origin.
 */

/**
 * The one origin the snippet may use.
 *
 * `window.location.origin` is NEVER consulted: it is `localhost` for anyone
 * running the dashboard on their own machine, which is exactly the bug this
 * module exists to prevent. Callers pass the server's answer.
 */
export function resolveWidgetScriptBaseUrl(
  publicOrigin: string | null | undefined,
): string {
  const trimmed = publicOrigin?.trim().replace(/\/+$/, '');
  return trimmed && /^https?:\/\//.test(trimmed) ? trimmed : '';
}

/**
 * True when the origin the server reported is this machine.
 *
 * The server answers with the loopback address when it has no
 * `PUBLIC_BASE_URL` and no proxy in front of it (#40). The snippet is still
 * copied — the operator may well be installing on the machine they are reading
 * the console from — but the console says so, because the snippet is only
 * shareable once the address is.
 */
export function isLoopbackOrigin(origin: string | null | undefined): boolean {
  const trimmed = origin?.trim().replace(/\/+$/, '');
  if (!trimmed) return false;
  try {
    const { hostname } = new URL(trimmed);
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    // IPv6 literals come back bracketed (`[::1]`).
    const bare = hostname.replace(/^\[|\]$/g, '');
    if (bare === '::1' || bare === '0.0.0.0') return true;
    // 127.0.0.0/8 — `startsWith` on the dotted form is exact enough here:
    // the string is a literal address, not a name to resolve.
    return bare.startsWith('127.');
  } catch {
    return false;
  }
}

/**
 * One `<script>` tag and nothing else.
 *
 * No inline config: `embed.js` already carries it. The returned text is exactly
 * what the copy button puts on the clipboard.
 */
export function buildWidgetEmbedCode(
  agentId: string,
  publicOrigin: string | null | undefined,
): string {
  const base = resolveWidgetScriptBaseUrl(publicOrigin);
  if (!base || !agentId) {
    return '';
  }
  const src = `${base}/api/v1/agents/${encodeURIComponent(agentId)}/embed.js`;
  return `<script src="${src}" async></script>`;
}
