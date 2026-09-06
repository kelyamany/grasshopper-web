'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_CATALOG } from './nodeCatalog';

export function SearchPopup({ x, y, onPick, onClose }: { x: number; y: number; onPick: (component: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => {
    const q = query.toLowerCase().trim();
    return NODE_CATALOG.filter(e => !q || [e.name, e.nickname, e.category, e.subcategory, e.description, ...(e.keywords ?? [])].join(' ').toLowerCase().includes(q)).slice(0, 14);
  }, [query]);

  return (
    <div className="gh-node-search" style={{ left: Math.min(x, window.innerWidth - 340), top: Math.min(y, window.innerHeight - 410) }}>
      <input
        ref={input}
        value={query}
        placeholder="Search components…"
        className="gh-node-search-input"
        onChange={e => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && items[active]) onPick(items[active].id);
        }}
      />
      <div className="max-h-[340px] overflow-auto p-1">
        {items.map((item, i) => (
          <button key={item.id} onMouseEnter={() => setActive(i)} onClick={() => onPick(item.id)} className={`gh-search-item ${i === active ? 'is-active' : ''}`}>
            <span className="gh-search-icon">{item.nickname.slice(0, 3)}</span><div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-[#3f3f46]">{item.name}</div>
              <div className="truncate text-[9px] text-[#92929b]">{item.description}</div>
            </div>
            <span className="ml-3 shrink-0 text-[9px] text-[#a1a1aa]">{item.category}</span>
          </button>
        ))}
        {items.length === 0 ? <div className="px-3 py-6 text-center text-[10px] text-[#a1a1aa]">No matching component</div> : null}
      </div>
    </div>
  );
}
