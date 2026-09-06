'use client';

import { useEffect, type ReactNode } from 'react';

export interface CanvasContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divided?: boolean;
  onSelect(): void;
}

export function CanvasContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CanvasContextMenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return (
    <div
      className="canvas-context-menu"
      style={{
        left: Math.min(x, window.innerWidth - 230),
        top: Math.min(y, window.innerHeight - (items.length * 38 + 24)),
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.divided ? <div className="canvas-context-menu__separator" /> : null}
          <button
            className={item.danger ? 'is-danger' : ''}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="canvas-context-menu__icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
