import { describe, expect, it } from 'vitest';
import { buildWidgetEmbedCode, resolveWidgetScriptBaseUrl } from '../../src/lib/widgetEmbedCode';

describe('resolveWidgetScriptBaseUrl', () => {
  it('uses explicit API base when provided', () => {
    expect(resolveWidgetScriptBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('falls back to current origin when API base is empty', () => {
    expect(resolveWidgetScriptBaseUrl('', 'https://admin.example.com/settings/agent')).toBe(
      'https://admin.example.com',
    );
  });
});

describe('buildWidgetEmbedCode', () => {
  it('generates sdk.js script with encoded agent_id', () => {
    expect(buildWidgetEmbedCode('agt 1', 'https://api.example.com')).toBe(
      '<script src="https://api.example.com/sdk.js?agent_id=agt+1" async></script>',
    );
  });

  it('includes api_base when the SDK origin differs from the runtime API base', () => {
    expect(
      buildWidgetEmbedCode('agt_1', 'https://admin.example.com', {
        apiBase: 'https://api.example.com',
      }),
    ).toBe(
      '<script src="https://admin.example.com/sdk.js?agent_id=agt_1&api_base=https%3A%2F%2Fapi.example.com" async></script>',
    );
  });
});