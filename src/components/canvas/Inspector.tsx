'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileUp,
  Play,
  RefreshCcw,
  WandSparkles,
  X,
} from 'lucide-react';

import { Viewer3D } from '@/components/viewer/Viewer3D';
import type { ResthopperTree } from '@/lib/compute/types';
import { runtimeToPreview, valueLabel, type RuntimeValue } from '@/lib/graph/runtime';
import { catalogEntry } from './nodeCatalog';
import { useGraphStore } from './useGraphStore';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function hopsKey(node: { hops?: { pointer?: string; algo?: string } }): string {
  return node.hops?.pointer
    ? `p:${node.hops.pointer}`
    : `a:${node.hops?.algo?.length ?? 0}:${node.hops?.algo?.slice(0, 32) ?? ''}`;
}

function defaultLabel(tree?: ResthopperTree | null): string {
  if (!tree) return '—';
  const items = Object.values(tree.InnerTree).flat();
  if (!items.length) return '—';
  if (items.length > 1) return `${items.length} items`;

  try {
    const value = JSON.parse(items[0].data) as unknown;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return items[0].type.replace('System.', '').replace('Rhino.Geometry.', '');
  } catch {
    return items[0].data;
  }
}

function compactValue(value: RuntimeValue | undefined): string {
  if (!value) return '—';
  const label = valueLabel(value);
  if (label.length <= 80) return label;
  return `${label.slice(0, 77)}…`;
}

export function Inspector() {
  const activeNodeId = useGraphStore((state) => state.activeNodeId);
  const node = useGraphStore((state) => state.document.nodes.find((item) => item.id === activeNodeId));
  const document = useGraphStore((state) => state.document);
  const results = useGraphStore((state) => state.results);
  const ioCache = useGraphStore((state) => state.ioCache);
  const updateNode = useGraphStore((state) => state.updateNode);
  const closeNode = useGraphStore((state) => state.closeNode);
  const describeHops = useGraphStore((state) => state.describeHops);
  const solve = useGraphStore((state) => state.solve);
  const runAction = useGraphStore((state) => state.runAction);
  const solving = useGraphStore((state) => state.solving);

  const [tab, setTab] = useState<'data' | 'preview'>('preview');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!activeNodeId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNode();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeNodeId, closeNode]);

  useEffect(() => {
    setTab('preview');
  }, [activeNodeId]);

  const entry = node ? catalogEntry(node.component) : undefined;
  const result = node ? results[node.id] : undefined;
  const io = node?.component === 'hops.definition' ? ioCache[hopsKey(node)] : undefined;

  const outputPreview = useMemo(() => {
    if (!result) return null;

    let candidate: RuntimeValue | null = null;
    for (const output of Object.values(result.outputs)) {
      if (output.kind === 'geometry' || output.kind === 'list') {
        candidate = output;
        break;
      }
    }

    return runtimeToPreview(candidate);
  }, [result]);

  if (!node) return null;

  const refreshHops = async (target = node) => {
    if (target.component !== 'hops.definition') return;
    setRefreshing(true);
    try {
      await describeHops(target);
    } catch (error) {
      console.error('[GHWeb][Hops I/O] Refresh failed', error);
    } finally {
      setRefreshing(false);
    }
  };

  const inputRows = node.component === 'hops.definition'
    ? (io?.Inputs ?? []).map((input) => {
        const edge = document.edges.find((item) => item.target.node === node.id && item.target.port === input.Name);
        const runtime = edge ? results[edge.source.node]?.outputs[edge.source.port] : undefined;
        return {
          name: input.Name,
          type: input.ParamType,
          connected: Boolean(edge),
          value: edge ? compactValue(runtime) : defaultLabel(input.Default),
        };
      })
    : (entry?.inputs ?? []).map((input) => {
        const edge = document.edges.find((item) => item.target.node === node.id && item.target.port === input.name);
        const runtime = edge ? results[edge.source.node]?.outputs[edge.source.port] : undefined;
        return {
          name: input.name,
          type: input.type,
          connected: Boolean(edge),
          value: edge ? compactValue(runtime) : input.defaultValue === undefined ? '—' : String(input.defaultValue),
        };
      });

  const outputRows = node.component === 'hops.definition'
    ? (io?.Outputs ?? []).map((output) => ({
        name: output.Name,
        type: output.ParamType,
        value: compactValue(result?.outputs[output.Name]),
      }))
    : (entry?.outputs ?? []).map((output) => ({
        name: output.name,
        type: output.type,
        value: compactValue(result?.outputs[output.name]),
      }));

  return (
    <div className="ndv-backdrop" onMouseDown={closeNode}>
      <section
        className="ndv"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${node.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ndv__header">
          <div className={`ndv__icon runtime-${entry?.runtime ?? 'local'}`}>
            {entry?.runtime === 'hops' ? 'GH' : entry?.runtime === 'compute' ? 'R' : entry?.runtime === 'display' ? '◈' : entry?.runtime === 'action' ? '↯' : 'ƒ'}
          </div>
          <div className="ndv__heading">
            <strong>{node.title}</strong>
            <span>{entry?.name ?? node.component}</span>
          </div>

          <div className="ndv__header-actions">
            <button className="secondary-button" onClick={() => void solve()} disabled={solving}>
              <Play size={14} />
              {solving ? 'Running…' : 'Run workflow'}
            </button>
            <button className="icon-button" onClick={closeNode} title="Close (Esc)">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="ndv__body">
          <aside className="ndv-panel ndv-panel--inputs">
            <div className="ndv-panel__header">
              <strong>Input</strong>
              <span>{inputRows.length} parameter{inputRows.length === 1 ? '' : 's'}</span>
            </div>

            <div className="ndv-panel__scroll">
              {inputRows.map((input) => (
                <div key={input.name} className="ndv-data-row">
                  <div className={`ndv-data-row__dot ${input.connected ? 'is-connected' : ''}`} />
                  <div className="ndv-data-row__copy">
                    <strong>{input.name}</strong>
                    <span>{input.type}</span>
                  </div>
                  <div className="ndv-data-row__value" title={input.value}>
                    {input.value}
                  </div>
                </div>
              ))}

              {!inputRows.length ? (
                <div className="ndv-empty">This node has no inputs.</div>
              ) : null}
            </div>
          </aside>

          <main className="ndv-panel ndv-panel--settings">
            <div className="ndv-panel__header">
              <strong>Parameters</strong>
              <span>{entry?.runtime === 'compute' ? 'Rhino Compute' : entry?.runtime ?? 'Node'}</span>
            </div>

            <div className="ndv-panel__scroll ndv-settings">
              <label className="field-label">
                Node name
                <input
                  className="field-input"
                  value={node.title}
                  onChange={(event) => updateNode(node.id, { title: event.target.value })}
                />
              </label>

              {node.component === 'params.number' || node.component === 'params.integer' ? (
                <section className="settings-card">
                  <div className="settings-card__title">Number parameter</div>
                  <div className="settings-grid">
                    {(['value', 'min', 'max'] as const).map((key) => (
                      <label className="field-label" key={key}>
                        {key}
                        <input
                          className="field-input"
                          type="number"
                          value={Number(node.values[key] ?? 0)}
                          onChange={(event) => updateNode(node.id, {
                            values: {
                              ...node.values,
                              [key]: node.component === 'params.integer'
                                ? Math.round(Number(event.target.value))
                                : Number(event.target.value),
                            },
                          })}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {node.component === 'params.boolean' ? (
                <section className="settings-card">
                  <div className="settings-card__title">Boolean parameter</div>
                  <button
                    className={`boolean-setting ${Boolean(node.values.value) ? 'is-on' : ''}`}
                    onClick={() => updateNode(node.id, {
                      values: { ...node.values, value: !Boolean(node.values.value) },
                    })}
                  >
                    <span />
                    {Boolean(node.values.value) ? 'True' : 'False'}
                  </button>
                </section>
              ) : null}

              {node.component === 'params.panel' ? (
                <label className="field-label">
                  Text
                  <textarea
                    className="field-input field-input--textarea"
                    value={String(node.values.value ?? '')}
                    onChange={(event) => updateNode(node.id, {
                      values: { ...node.values, value: event.target.value },
                    })}
                  />
                </label>
              ) : null}

              {node.component === 'hops.definition' ? (
                <section className="settings-card">
                  <div className="settings-card__title">Grasshopper definition</div>
                  <p>
                    Keep existing .gh/.ghx logic server-side while exposing its inputs and outputs as a web node.
                  </p>

                  <label className="field-label">
                    Definition URL
                    <input
                      className="field-input"
                      placeholder="https://…/definition.gh"
                      value={node.hops?.pointer ?? ''}
                      onChange={(event) => updateNode(node.id, {
                        hops: {
                          ...node.hops,
                          pointer: event.target.value,
                          algo: event.target.value ? undefined : node.hops?.algo,
                        },
                      })}
                      onBlur={() => {
                        if (node.hops?.pointer) void refreshHops();
                      }}
                    />
                  </label>

                  <div className="settings-divider"><span>or</span></div>

                  <label className="upload-button">
                    <FileUp size={15} />
                    Upload .gh / .ghx
                    <input
                      type="file"
                      accept=".gh,.ghx"
                      hidden
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;

                        try {
                          const next = {
                            ...node,
                            title: file.name.replace(/\.(gh|ghx)$/i, ''),
                            hops: {
                              label: file.name,
                              algo: await fileToBase64(file),
                              pointer: undefined,
                            },
                          };

                          updateNode(node.id, { title: next.title, hops: next.hops });
                          await refreshHops(next);
                        } catch (error) {
                          console.error('[GHWeb][Hops upload] Could not load definition', error);
                        }

                        event.currentTarget.value = '';
                      }}
                    />
                  </label>

                  <div className="settings-inline-status">
                    <span>
                      {node.hops?.algo
                        ? `${Math.round(node.hops.algo.length * .75 / 1024)} KB embedded`
                        : node.hops?.pointer
                          ? 'URL-backed definition'
                          : 'No definition selected'}
                    </span>
                    <button onClick={() => void refreshHops()} disabled={refreshing}>
                      <RefreshCcw size={13} />
                      {refreshing ? 'Loading…' : 'Refresh ports'}
                    </button>
                  </div>
                </section>
              ) : null}

              {node.component === 'hops.python-generator' ? (
                <section className="settings-card">
                  <div className="settings-card__title">Grasshopper Python generator</div>
                  <p>
                    Paste the Rhino/Grasshopper Python script here, or connect a text Panel to the Script input.
                    Generation only runs when you explicitly click Generate.
                  </p>

                  <label className="field-label">
                    Job name
                    <input
                      className="field-input"
                      value={String(node.values.jobName ?? 'grasshopper-catalog')}
                      onChange={(event) => updateNode(node.id, {
                        values: { ...node.values, jobName: event.target.value },
                      })}
                    />
                  </label>

                  <label className="field-label">
                    Python script
                    <textarea
                      className="field-input field-input--textarea"
                      style={{ minHeight: 260, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                      value={String(node.values.script ?? '')}
                      onChange={(event) => updateNode(node.id, {
                        values: { ...node.values, script: event.target.value },
                      })}
                      placeholder="Paste a Rhino/Grasshopper Python generator script…"
                    />
                  </label>

                  <label className="upload-button">
                    <FileUp size={15} />
                    Load .py script
                    <input
                      type="file"
                      accept=".py,text/x-python"
                      hidden
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        updateNode(node.id, {
                          values: {
                            ...node.values,
                            script: await file.text(),
                            jobName: String(node.values.jobName ?? file.name.replace(/\.py$/i, '')),
                          },
                        });
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>

                  <button
                    className="secondary-button"
                    onClick={() => void runAction(node.id)}
                    disabled={result?.state === 'solving'}
                  >
                    <WandSparkles size={14} />
                    {result?.state === 'solving' ? 'Generating…' : 'Generate files'}
                  </button>

                  <div className="settings-inline-status">
                    <span>
                      The server forwards this script to GRASSHOPPER_GENERATOR_URL. The trusted runner must execute it inside a Rhino/Grasshopper-capable environment and return files as base64.
                    </span>
                  </div>
                </section>
              ) : null}

              {node.component === 'files.download' ? (
                <section className="settings-card">
                  <div className="settings-card__title">Download generated files</div>
                  <p>
                    Nothing downloads during auto-solve. Downloads happen only after an explicit click.
                  </p>

                  <label className="field-label">
                    <span>Prefer ZIP/archive when available</span>
                    <input
                      type="checkbox"
                      checked={Boolean(node.values.preferArchive ?? true)}
                      onChange={(event) => updateNode(node.id, {
                        values: { ...node.values, preferArchive: event.target.checked },
                      })}
                    />
                  </label>

                  <button
                    className="secondary-button"
                    onClick={() => void runAction(node.id)}
                    disabled={result?.state === 'solving'}
                  >
                    <Download size={14} />
                    {result?.state === 'solving' ? 'Preparing…' : 'Download now'}
                  </button>
                </section>
              ) : null}

              {entry?.runtime === 'compute' && entry.compute ? (
                <section className="settings-card settings-card--compute">
                  <div className="settings-card__title">Rhino Compute</div>
                  <code>/{entry.compute.endpoint}</code>
                </section>
              ) : null}

              {result?.state === 'error' ? (
                <section className="settings-message is-error">
                  <strong>Execution error</strong>
                  <span>{result.message}</span>
                </section>
              ) : null}

              {result?.state === 'done' && result.message ? (
                <section className="settings-message is-warning">
                  <strong>Warnings</strong>
                  <span>{result.message}</span>
                </section>
              ) : null}

              {entry?.description ? (
                <section className="settings-card">
                  <div className="settings-card__title">About this node</div>
                  <p>{entry.description}</p>
                </section>
              ) : null}
            </div>
          </main>

          <aside className="ndv-panel ndv-panel--outputs">
            <div className="ndv-output-tabs">
              <button className={tab === 'data' ? 'is-active' : ''} onClick={() => setTab('data')}>
                Output
              </button>
              <button className={tab === 'preview' ? 'is-active' : ''} onClick={() => setTab('preview')}>
                3D Preview
              </button>
            </div>

            {tab === 'preview' ? (
              <div className="ndv-preview">
                <Viewer3D value={outputPreview} />
              </div>
            ) : (
              <div className="ndv-panel__scroll">
                {outputRows.map((output) => (
                  <div key={output.name} className="ndv-output-row">
                    <div>
                      <strong>{output.name}</strong>
                      <span>{output.type}</span>
                    </div>
                    <code title={output.value}>{output.value}</code>
                  </div>
                ))}

                {!outputRows.length ? <div className="ndv-empty">No output data yet.</div> : null}
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
