'use client';

import '@xyflow/react/dist/style.css';

import { GraphCanvas } from '@/components/canvas/GraphCanvas';
import { Inspector } from '@/components/canvas/Inspector';
import { Toolbar } from '@/components/canvas/Toolbar';
import { GraphStoreProvider } from '@/components/canvas/useGraphStore';
import { FloatingViewer } from '@/components/viewer/FloatingViewer';

export default function Home() {
  return (
    <GraphStoreProvider>
      <main className="editor-shell">
        <Toolbar />
        <div className="editor-workspace">
          <div className="editor-canvas-pane">
            <GraphCanvas />
          </div>
          <FloatingViewer />
        </div>
        <Inspector />
      </main>
    </GraphStoreProvider>
  );
}
