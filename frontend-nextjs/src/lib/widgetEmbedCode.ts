export interface WidgetEmbedCodeOptions {
  apiBase?: string;
}

export function resolveWidgetScriptBaseUrl(
  configuredApiBase: string | undefined,
  currentHref?: string,
): string {
  const trimmed = configuredApiBase?.trim().replace(/\/$/, '');
  if (trimmed) return trimmed;

  if (currentHref) {
    return new URL(currentHref).origin;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
}

export function buildWidgetEmbedCode(
  agentId: string,
  scriptBaseUrl: string,
  options: WidgetEmbedCodeOptions = {},
): string {
  const sdkUrl = new URL('/sdk.js', `${scriptBaseUrl.replace(/\/$/, '')}/`);
  sdkUrl.searchParams.set('agent_id', agentId);
  // Always include api_base so the widget knows where to connect,
  // especially important when embedded on third-party sites
  const apiBase = options.apiBase?.trim() || scriptBaseUrl;
  if (apiBase) {
    sdkUrl.searchParams.set('api_base', apiBase.replace(/\/$/, ''));
  }
  return `<script src="${sdkUrl.toString()}" async></script>`;
}