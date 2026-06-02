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
  if (options.apiBase?.trim()) {
    sdkUrl.searchParams.set('api_base', options.apiBase.trim().replace(/\/$/, ''));
  }
  return `<script src="${sdkUrl.toString()}" async></script>`;
}