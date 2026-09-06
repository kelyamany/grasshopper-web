'use client';

import { useRef } from 'react';
import {
  Box,
  Download,
  MoreHorizontal,
  Play,
  Upload,
} from 'lucide-react';

import { parseDocument } from '@/lib/graph/schema';
import { useGraphStore } from './useGraphStore';

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Toolbar() {
  const document = useGraphStore((state) => state.document);
  const solve = useGraphStore((state) => state.solve);
  const solving = useGraphStore((state) => state.solving);
  const autoSolve = useGraphStore((state) => state.autoSolve);
  const setAutoSolve = useGraphStore((state) => state.setAutoSolve);
  const previewOpen = useGraphStore((state) => state.previewOpen);
  const setPreviewOpen = useGraphStore((state) => state.setPreviewOpen);
  const lastSolveMs = useGraphStore((state) => state.lastSolveMs);
  const replaceDocument = useGraphStore((state) => state.replaceDocument);
  const setDocumentName = useGraphStore((state) => state.setDocumentName);

  const importRef = useRef<HTMLInputElement>(null);

  return (
    <header className="editor-topbar">
      <div className="editor-topbar__left">
        <div className="brand-mark">G</div>
        <strong className="brand-name">Grasshopper Web</strong>
        <div className="topbar-divider" />

        <input
          className="workflow-name"
          value={document.name}
          onChange={(event) => setDocumentName(event.target.value)}
          aria-label="Definition name"
        />

        <span className="execution-time">
          {lastSolveMs == null ? 'Ready' : `${Math.round(lastSolveMs)} ms`}
        </span>
      </div>

      <div className="editor-topbar__right">
        <label className="autosolve-control" title="Automatically solve when data changes">
          <span>Auto solve</span>
          <input
            type="checkbox"
            checked={autoSolve}
            onChange={(event) => setAutoSolve(event.target.checked)}
          />
          <i />
        </label>

        <button
          className="topbar-button topbar-button--primary"
          onClick={() => void solve()}
          disabled={solving}
        >
          <Play size={14} fill="currentColor" />
          {solving ? 'Running…' : 'Solve'}
        </button>

        <button
          className={`topbar-button ${previewOpen ? 'is-active' : ''}`}
          onClick={() => setPreviewOpen(!previewOpen)}
        >
          <Box size={15} />
          Preview
        </button>

        <details className="topbar-more">
          <summary className="icon-button" title="More actions">
            <MoreHorizontal size={18} />
          </summary>
          <div className="topbar-menu">
            <button
              onClick={() => downloadText(
                `${document.name || 'definition'}.ghweb.json`,
                JSON.stringify(document, null, 2),
              )}
            >
              <Download size={14} />
              Export definition
            </button>
            <button onClick={() => importRef.current?.click()}>
              <Upload size={14} />
              Import definition
            </button>
          </div>
        </details>

        <input
          ref={importRef}
          type="file"
          accept=".json,.ghweb.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
              replaceDocument(parseDocument(JSON.parse(await file.text())));
            } catch (error) {
              console.error('[GHWeb][import] Invalid definition', error);
              window.alert('Could not import this definition. Check the console for details.');
            }

            event.currentTarget.value = '';
          }}
        />
      </div>
    </header>
  );
}
