'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { CATEGORIES, NODE_CATALOG, type RuntimeKind } from './nodeCatalog';

const runtimeLabel: Record<RuntimeKind, string> = {
  local: 'Local',
  compute: 'Rhino Compute',
  hops: 'Grasshopper',
  display: 'Display',
  action: 'Action',
};

export function NodeCreator({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (component: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NODE_CATALOG.filter((entry) => {
      if (category !== 'All' && entry.category !== category) return false;
      if (!q) return true;
      return [
        entry.name,
        entry.nickname,
        entry.category,
        entry.subcategory,
        entry.description,
        ...(entry.keywords ?? []),
      ].join(' ').toLowerCase().includes(q);
    });
  }, [query, category]);

  if (!open) return null;

  return (
    <aside className="node-creator" onMouseDown={(event) => event.stopPropagation()}>
      <header className="node-creator__header">
        <div>
          <div className="node-creator__eyebrow">Add to canvas</div>
          <h2>What happens next?</h2>
        </div>
        <button className="icon-button" onClick={onClose} title="Close node creator">
          <X size={16} />
        </button>
      </header>

      <div className="node-creator__search">
        <Search size={15} />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search nodes…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Enter' && items[0]) onPick(items[0].id);
          }}
        />
        <span className="shortcut-chip">⌘K</span>
      </div>

      <div className="node-creator__categories">
        {['All', ...CATEGORIES.filter((value) => value !== 'Transform')].map((value) => (
          <button
            key={value}
            className={category === value ? 'is-active' : ''}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="node-creator__list">
        {items.map((entry) => (
          <button key={entry.id} className="node-creator__item" onClick={() => onPick(entry.id)}>
            <span className={`node-creator__icon runtime-${entry.runtime}`}>
              {entry.runtime === 'hops' ? 'GH' : entry.nickname.slice(0, 2)}
            </span>
            <span className="node-creator__copy">
              <strong>{entry.name}</strong>
              <small>{entry.description}</small>
            </span>
            <span className="node-creator__runtime">{runtimeLabel[entry.runtime]}</span>
          </button>
        ))}

        {!items.length ? (
          <div className="node-creator__empty">
            No components match “{query}”.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
