'use client';

import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { useGraphStore } from '@/components/canvas/useGraphStore';
import { runtimeToPreview, type RuntimeValue } from '@/lib/graph/runtime';
import { Viewer3D } from './Viewer3D';

export function FloatingViewer() {
  const open = useGraphStore((state) => state.previewOpen);
  const setOpen = useGraphStore((state) => state.setPreviewOpen);
  const doc = useGraphStore((state) => state.document);
  const results = useGraphStore((state) => state.results);
  const [width, setWidth] = useState(430);
  const dragging = useRef(false);

  const value = useMemo(() => {
    const previewNodes = doc.nodes.filter((node) => node.component === 'display.preview');
    let candidate: RuntimeValue | null = null;

    for (const node of previewNodes) {
      candidate = results[node.id]?.outputs.G ?? candidate;
    }

    if (!candidate) {
      for (const result of Object.values(results)) {
        for (const output of Object.values(result.outputs)) {
          if (output.kind === 'geometry' || output.kind === 'list') candidate = output;
        }
      }
    }

    return runtimeToPreview(candidate);
  }, [doc.nodes, results]);

  if (!open) return null;

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.max(320, Math.min(760, window.innerWidth - moveEvent.clientX));
      setWidth(next);
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside className="preview-dock" style={{ width }}>
      <div className="preview-dock__resizer" onPointerDown={beginResize} />
      <header className="preview-dock__header">
        <div>
          <strong>3D Preview</strong>
          <span>Rhino geometry</span>
        </div>
        <button className="icon-button" onClick={() => setOpen(false)} title="Close preview">
          <X size={16} />
        </button>
      </header>
      <div className="preview-dock__viewer">
        <Viewer3D value={value} />
      </div>
    </aside>
  );
}
