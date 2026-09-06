'use client';

import type { ReactNode } from 'react';

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;

  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function primitive(value: unknown): ReactNode {
  if (value === null) return <span className="json-tree__null">null</span>;
  if (typeof value === 'string') return <span className="json-tree__string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-tree__number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="json-tree__boolean">{value ? 'true' : 'false'}</span>;
  return <span>{String(value)}</span>;
}

function Branch({
  label,
  value,
  depth,
}: {
  label?: string;
  value: unknown;
  depth: number;
}) {
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-tree__leaf">
        {label !== undefined ? <span className="json-tree__key">{label}: </span> : null}
        {primitive(value)}
      </div>
    );
  }

  const array = Array.isArray(value);
  const entries = array
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <details className="json-tree__branch" open={depth < 1}>
      <summary className="json-tree__summary">
        {label !== undefined ? <span className="json-tree__key">{label}</span> : null}
        <span className="json-tree__meta">
          {array ? 'Array(' + entries.length + ')' : 'Object(' + entries.length + ')'}
        </span>
      </summary>
      <div className="json-tree__children">
        {entries.length ? entries.map(([key, child]) => (
          <Branch
            key={key}
            label={array ? '[' + key + ']' : key}
            value={child}
            depth={depth + 1}
          />
        )) : (
          <div className="json-tree__leaf json-tree__empty">
            {array ? '[]' : '{}'}
          </div>
        )}
      </div>
    </details>
  );
}

export function JsonOrText({ value }: { value: string }) {
  const parsed = parseJsonObject(value);

  if (parsed === null) {
    return <div className="json-tree__plain">{value || 'Empty'}</div>;
  }

  return (
    <div className="json-tree">
      <Branch value={parsed} depth={0} />
    </div>
  );
}
