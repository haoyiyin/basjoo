import type { CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

const inlineCodeStyle: CSSProperties = {
  background: 'var(--color-bg-glass)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  padding: '0.1rem 0.35rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '0.9em',
};

const blockCodeStyle: CSSProperties = {
  display: 'block',
  overflowX: 'auto',
  padding: '0.875rem 1rem',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '0.9em',
  lineHeight: 1.6,
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p style={{ margin: '0 0 0.75rem 0' }}>{children}</p>,
        ul: ({ children }) => <ul style={{ margin: '0 0 0.75rem 1.25rem', padding: 0 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: '0 0 0.75rem 1.25rem', padding: 0 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: '0.25rem' }}>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote
            style={{
              margin: '0 0 0.75rem 0',
              padding: '0.25rem 0 0.25rem 0.875rem',
              borderLeft: '3px solid var(--color-accent-primary)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-accent-primary)' }}
          >
            {children}
          </a>
        ),
        pre: ({ children }) => <pre style={{ margin: '0 0 0.75rem 0' }}>{children}</pre>,
        code: ({ inline, children, ...props }: any) =>
          inline ? (
            <code style={inlineCodeStyle} {...props}>
              {children}
            </code>
          ) : (
            <code style={blockCodeStyle} {...props}>
              {children}
            </code>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
