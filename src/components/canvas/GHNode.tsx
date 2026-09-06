'use client';

import { useMemo, useState } from 'react';
import {
  Handle,
  NodeToolbar,
  Position,
  type NodeProps,
} from '@xyflow/react';
import {
  Copy,
  Download,
  Maximize2,
  Play,
  Trash2,
  WandSparkles,
} from 'lucide-react';

import { valueLabel, type RuntimeValue } from '@/lib/graph/runtime';
import { catalogEntry, type PortSpec } from './nodeCatalog';
import { JsonOrText } from './JsonTree';
import { useGraphStore } from './useGraphStore';

export interface GHNodeData extends Record<string, unknown> {
  nodeId: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  connectedInputs: Record<string, boolean>;
}

const runtimeTone = {
  local: { label: 'ƒ', className: 'runtime-local' },
  compute: { label: 'R', className: 'runtime-compute' },
  hops: { label: 'GH', className: 'runtime-hops' },
  display: { label: '◈', className: 'runtime-display' },
  action: { label: '↯', className: 'runtime-action' },
} as const;

function formatDefault(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.length > 18 ? `${value.slice(0, 16)}…` : value;
  return '';
}

function PortRow({
  port,
  side,
  connected,
  output,
}: {
  port: PortSpec;
  side: 'input' | 'output';
  connected?: boolean;
  output?: RuntimeValue;
}) {
  const secondary = side === 'input' && !connected
    ? formatDefault(port.defaultValue)
    : side === 'output'
      ? valueLabel(output)
      : '';

  return (
    <div className={`workflow-port-row workflow-port-row--${side}`}>
      <Handle
        type={side === 'input' ? 'target' : 'source'}
        position={side === 'input' ? Position.Left : Position.Right}
        id={port.name}
        className={`workflow-port ${connected ? 'is-connected' : ''}`}
      />

      {side === 'input' ? (
        <>
          <span className="workflow-port-row__name">{port.name}</span>
          {secondary ? <span className="workflow-port-row__value">{secondary}</span> : null}
        </>
      ) : (
        <>
          {secondary ? <span className="workflow-port-row__value">{secondary}</span> : null}
          <span className="workflow-port-row__name">{port.name}</span>
        </>
      )}
    </div>
  );
}

function SliderControl({ nodeId, integer }: { nodeId: string; integer: boolean }) {
  const node = useGraphStore((state) => state.document.nodes.find((item) => item.id === nodeId));
  const updateNode = useGraphStore((state) => state.updateNode);

  if (!node) return null;

  const value = Number(node.values.value ?? 0);
  const min = Number(node.values.min ?? 0);
  const max = Number(node.values.max ?? 100);
  const step = integer ? 1 : Math.max((max - min) / 500, 0.001);

  const setValue = (next: number) => {
    updateNode(nodeId, {
      values: {
        ...node.values,
        value: integer ? Math.round(next) : next,
      },
    });
  };

  return (
    <div className="workflow-parameter nodrag nowheel">
      <div className="workflow-parameter__row">
        <input
          type="number"
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
        <span>{min} – {max}</span>
      </div>
      <input
        className="workflow-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    </div>
  );
}

function BooleanControl({ nodeId }: { nodeId: string }) {
  const node = useGraphStore((state) => state.document.nodes.find((item) => item.id === nodeId));
  const updateNode = useGraphStore((state) => state.updateNode);
  if (!node) return null;

  const checked = Boolean(node.values.value);

  return (
    <div className="workflow-parameter nodrag">
      <button
        className={`workflow-boolean ${checked ? 'is-on' : ''}`}
        onClick={() => updateNode(node.id, { values: { ...node.values, value: !checked } })}
      >
        <span />
        {checked ? 'True' : 'False'}
      </button>
    </div>
  );
}

export function GHNode({ data, selected }: NodeProps) {
  const d = data as GHNodeData;
  const node = useGraphStore((state) => state.document.nodes.find((item) => item.id === d.nodeId));
  const result = useGraphStore((state) => state.results[d.nodeId]);
  const solve = useGraphStore((state) => state.solve);
  const runAction = useGraphStore((state) => state.runAction);
  const openNode = useGraphStore((state) => state.openNode);
  const duplicateNodes = useGraphStore((state) => state.duplicateNodes);
  const removeNodes = useGraphStore((state) => state.removeNodes);
  const [expandedInputs, setExpandedInputs] = useState(false);

  const entry = node ? catalogEntry(node.component) : undefined;
  const runtime = entry?.runtime ?? 'local';
  const tone = runtimeTone[runtime];
  const status = result?.state ?? 'idle';

  const visibleInputs = useMemo(() => {
    if (!node || node.component !== 'hops.definition' || expandedInputs || d.inputs.length <= 5) {
      return d.inputs;
    }

    const pinned = d.inputs.filter((port, index) => d.connectedInputs[port.name] || !port.optional || index < 4);
    return pinned.slice(0, 5);
  }, [node, expandedInputs, d.inputs, d.connectedInputs]);

  if (!node) return null;

  const hiddenInputCount = Math.max(0, d.inputs.length - visibleInputs.length);
  const isNumber = node.component === 'params.number' || node.component === 'params.integer';
  const isBoolean = node.component === 'params.boolean';
  const isParameter = isNumber || isBoolean;
  const isPreview = node.component === 'display.preview';

  return (
    <section
      className={[
        'workflow-node',
        `workflow-node--${runtime}`,
        node.component === 'hops.definition' ? 'workflow-node--hops' : '',
        isParameter ? 'workflow-node--parameter' : '',
        isPreview ? 'workflow-node--preview' : '',
        selected ? 'is-selected' : '',
        status === 'error' ? 'is-error' : '',
      ].filter(Boolean).join(' ')}
    >
      <NodeToolbar
        isVisible={Boolean(selected)}
        position={Position.Top}
        offset={9}
        align="center"
      >
        <div className="node-toolbar nodrag">
          <button onClick={() => void solve()} title="Solve workflow">
            <Play size={14} />
          </button>
          <button onClick={() => openNode(node.id)} title="Open node">
            <Maximize2 size={14} />
          </button>
          <button onClick={() => duplicateNodes([node.id])} title="Duplicate">
            <Copy size={14} />
          </button>
          <button className="is-danger" onClick={() => removeNodes([node.id])} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </NodeToolbar>

      <header className="workflow-node__header gh-node-drag-handle">
        <div className={`workflow-node__icon ${tone.className}`}>{tone.label}</div>
        <div className="workflow-node__title">
          <strong title={node.title}>{node.title}</strong>
          <span>{entry?.subcategory ?? entry?.category ?? runtime}</span>
        </div>

        <div
          className={[
            'workflow-node__status',
            status === 'done' ? 'is-success' : '',
            status === 'error' ? 'is-error' : '',
          ].filter(Boolean).join(' ')}
          title={result?.message ?? status}
        />
      </header>

      {isNumber ? (
        <>
          {d.outputs[0] ? (
            <Handle
              type="source"
              position={Position.Right}
              id={d.outputs[0].name}
              className="workflow-port workflow-port--parameter"
            />
          ) : null}
          <SliderControl nodeId={node.id} integer={node.component === 'params.integer'} />
        </>
      ) : isBoolean ? (
        <>
          {d.outputs[0] ? (
            <Handle
              type="source"
              position={Position.Right}
              id={d.outputs[0].name}
              className="workflow-port workflow-port--parameter"
            />
          ) : null}
          <BooleanControl nodeId={node.id} />
        </>
      ) : (
        <>
          <div className="workflow-node__ports">
            <div className="workflow-node__ports-column">
              {visibleInputs.map((port) => (
                <PortRow
                  key={port.name}
                  port={port}
                  side="input"
                  connected={Boolean(d.connectedInputs[port.name])}
                />
              ))}
              {!visibleInputs.length ? <div className="workflow-port-spacer" /> : null}
            </div>

            <div className="workflow-node__ports-column workflow-node__ports-column--output">
              {d.outputs.map((port) => (
                <PortRow
                  key={port.name}
                  port={port}
                  side="output"
                  output={result?.outputs[port.name]}
                />
              ))}
              {!d.outputs.length ? <div className="workflow-port-spacer" /> : null}
            </div>
          </div>

          {hiddenInputCount > 0 ? (
            <button
              className="workflow-node__more nodrag"
              onClick={() => setExpandedInputs(true)}
            >
              + {hiddenInputCount} default input{hiddenInputCount === 1 ? '' : 's'}
            </button>
          ) : node.component === 'hops.definition' && expandedInputs && d.inputs.length > 5 ? (
            <button
              className="workflow-node__more nodrag"
              onClick={() => setExpandedInputs(false)}
            >
              Collapse default inputs
            </button>
          ) : null}

          {node.component === 'params.panel' ? (
            <div className="workflow-panel-preview nodrag nowheel">
              <JsonOrText
                value={
                  result?.outputs.Out?.kind === 'text'
                    ? result.outputs.Out.value
                    : String(node.values.value ?? '')
                }
              />
            </div>
          ) : null}

          {node.component === 'hops.python-generator' ? (
            <button
              className="workflow-node__more nodrag"
              onClick={() => void runAction(node.id)}
              disabled={status === 'solving'}
            >
              <WandSparkles size={13} />
              {status === 'solving' ? 'Generating…' : 'Generate .gh files'}
            </button>
          ) : null}

          {node.component === 'files.download' ? (
            <button
              className="workflow-node__more nodrag"
              onClick={() => void runAction(node.id)}
              disabled={status === 'solving'}
            >
              <Download size={13} />
              {status === 'solving' ? 'Preparing…' : 'Download'}
            </button>
          ) : null}
        </>
      )}

      {status === 'error' ? (
        <div className="workflow-node__message is-error" title={result?.message}>
          {result?.message}
        </div>
      ) : status === 'done' && result?.message ? (
        <div className="workflow-node__message is-warning" title={result.message}>
          {result.message}
        </div>
      ) : null}
    </section>
  );
}
