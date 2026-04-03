import type { Source } from '../services/api';

export interface CitationReference {
  title: string;
  url: string;
}

export interface CitationDisplayContent {
  content: string;
  references: CitationReference[];
}

const INLINE_CITATION_PATTERN = /\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g;

function isUrlSource(source: Source | undefined): source is Source & { type: 'url'; url: string } {
  return Boolean(
    source
      && source.type === 'url'
      && typeof source.url === 'string'
      && /^https?:\/\//.test(source.url)
  );
}

export function formatAssistantMessageContent(
  content: string,
  sources: Source[] = [],
): CitationDisplayContent {
  if (!content) {
    return { content, references: [] };
  }

  const references: CitationReference[] = [];
  const seenUrls = new Set<string>();
  const sourceByUrl = new Map<string, Source & { type: 'url'; url: string }>();

  for (const source of sources) {
    if (!isUrlSource(source) || sourceByUrl.has(source.url)) {
      continue;
    }
    sourceByUrl.set(source.url, source);
  }

  const addReference = (url: string) => {
    if (seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);
    const source = sourceByUrl.get(url);
    references.push({
      title: source?.title?.trim() || url,
      url,
    });
  };

  const formattedContent = content.replace(
    INLINE_CITATION_PATTERN,
    (_match, label: string, target: string, sourceIndexText?: string) => {
      if (sourceIndexText) {
        const sourceIndex = Number(sourceIndexText) - 1;
        const source = sources[sourceIndex];
        if (isUrlSource(source)) {
          addReference(source.url);
        }
        return label;
      }

      if (sourceByUrl.has(target)) {
        addReference(target);
        return label;
      }

      return _match;
    },
  );

  return {
    content: formattedContent,
    references,
  };
}
