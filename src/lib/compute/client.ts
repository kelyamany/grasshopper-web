import 'server-only';

import type { GrasshopperSolveRequest, GrasshopperSolveResponse, IoResponse } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const LOG_PREFIX = '[GHWeb][Compute]';

export class ComputeError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'ComputeError';
  }
}

function config() {
  return {
    baseUrl: (process.env.RHINO_COMPUTE_URL || 'http://localhost:6500').replace(/\/+$/, ''),
    apiKey: process.env.RHINO_COMPUTE_KEY || '',
    token: process.env.RHINO_COMPUTE_TOKEN || '',
  };
}

function requestId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function summarizeBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    return {
      kind: 'array',
      length: body.length,
      sample: body.slice(0, 3).map(summarizeBody),
    };
  }

  if (!body || typeof body !== 'object') {
    if (typeof body === 'string' && body.length > 160) return `<string ${body.length} chars>`;
    return body;
  }

  const object = body as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(object)) {
    if (key === 'algo' && typeof value === 'string') {
      result.algo = `<embedded definition ${Math.round(value.length * 0.75 / 1024)} KB>`;
      continue;
    }
    if (key === 'values' && Array.isArray(value)) {
      result.values = value.map(tree => {
        const t = tree as { ParamName?: string; InnerTree?: Record<string, unknown[]> };
        return {
          ParamName: t.ParamName,
          branches: t.InnerTree ? Object.keys(t.InnerTree).length : 0,
          items: t.InnerTree ? Object.values(t.InnerTree).reduce((sum, items) => sum + items.length, 0) : 0,
        };
      });
      continue;
    }
    if (typeof value === 'string' && value.length > 240) {
      result[key] = `<string ${value.length} chars>`;
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = { length: value.length, sample: value.slice(0, 2).map(summarizeBody) };
      continue;
    }
    if (value && typeof value === 'object') {
      result[key] = summarizeBody(value);
      continue;
    }
    result[key] = value;
  }

  return result;
}

function summarizeResponse(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const object = parsed as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  const values = object.values;
  if (Array.isArray(values)) {
    summary.outputs = values.map((tree) => {
      const t = tree as {
        ParamName?: string;
        InnerTree?: Record<string, Array<{ type?: string }>>;
      };
      const items = t.InnerTree ? Object.values(t.InnerTree).flat() : [];
      const types = [...new Set(items.map((item) => item.type).filter(Boolean))];
      return {
        ParamName: t.ParamName,
        branches: t.InnerTree ? Object.keys(t.InnerTree).length : 0,
        items: items.length,
        types: types.slice(0, 6),
      };
    });
  }

  if (Array.isArray(object.Inputs)) {
    summary.inputs = (object.Inputs as Array<Record<string, unknown>>).map((input) => ({
      name: input.Name,
      type: input.ParamType,
      hasDefault: Boolean(input.Default),
    }));
  }

  if (Array.isArray(object.Outputs)) {
    summary.outputsSchema = (object.Outputs as Array<Record<string, unknown>>).map((output) => ({
      name: output.Name,
      type: output.ParamType,
    }));
  }

  const warnings = object.warnings ?? object.Warnings;
  const errors = object.errors ?? object.Errors;
  if (Array.isArray(warnings) && warnings.length) summary.warnings = warnings;
  if (Array.isArray(errors) && errors.length) summary.errors = errors;

  return Object.keys(summary).length ? summary : { keys: Object.keys(object).slice(0, 20) };
}

function logComputeMessages(id: string, path: string, parsed: unknown) {
  if (!parsed || typeof parsed !== 'object') return;
  const object = parsed as Record<string, unknown>;
  const warnings = (object.warnings ?? object.Warnings) as unknown;
  const errors = (object.errors ?? object.Errors) as unknown;
  if (Array.isArray(warnings) && warnings.length) console.warn(`${LOG_PREFIX}[${id}] /${path} warnings`, warnings);
  if (Array.isArray(errors) && errors.length) console.error(`${LOG_PREFIX}[${id}] /${path} errors`, errors);
}

export async function computePost<T>(path: string, body: unknown): Promise<T> {
  const { baseUrl, apiKey, token } = config();
  const id = requestId();
  const started = Date.now();
  const normalizedPath = path.replace(/^\/+/, '');
  const url = `${baseUrl}/${normalizedPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.RhinoComputeKey = apiKey;
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  console.info(
    `${LOG_PREFIX}[${id}] → POST /${normalizedPath}\n${JSON.stringify({
      target: baseUrl,
      body: summarizeBody(body),
    }, null, 2)}`,
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    const durationMs = Date.now() - started;

    console.info(`${LOG_PREFIX}[${id}] ← ${response.status} /${normalizedPath} in ${durationMs} ms`, {
      bytes: text.length,
      contentType: response.headers.get('content-type'),
    });

    if (!response.ok) {
      const excerpt = text.slice(0, 4000);
      let detail = excerpt;
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string; errors?: unknown; warnings?: unknown };
        detail = parsed.message ?? parsed.error ?? detail;
        logComputeMessages(id, normalizedPath, parsed);
      } catch {
        // Plain-text Compute errors are useful as-is.
      }

      console.error(
        `${LOG_PREFIX}[${id}] Request failed\n${JSON.stringify({
          url,
          status: response.status,
          durationMs,
          request: summarizeBody(body),
          response: excerpt,
        }, null, 2)}`,
      );

      throw new ComputeError(
        `Rhino Compute ${response.status} on /${normalizedPath}: ${detail}`,
        response.status === 400 ? 400 : 502,
      );
    }

    if (!text) return null as T;

    try {
      const parsed = JSON.parse(text) as T;
      logComputeMessages(id, normalizedPath, parsed);
      console.info(
        `${LOG_PREFIX}[${id}] ✓ /${normalizedPath} response summary\n${JSON.stringify(
          summarizeResponse(parsed),
          null,
          2,
        )}`,
      );
      return parsed;
    } catch (error) {
      console.error(`${LOG_PREFIX}[${id}] Invalid JSON response`, {
        url,
        response: text.slice(0, 4000),
        error,
      });
      throw new ComputeError(`Rhino Compute returned invalid JSON from /${normalizedPath}`, 502);
    }
  } catch (error) {
    if (error instanceof ComputeError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error(`${LOG_PREFIX}[${id}] Timed out after ${DEFAULT_TIMEOUT_MS} ms`, { url });
      throw new ComputeError('Rhino Compute timed out', 504);
    }

    console.error(`${LOG_PREFIX}[${id}] Network/request failure`, { url, error });
    throw new ComputeError(
      `Cannot reach Rhino Compute at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function inspectDefinition(source: { pointer?: string; algo?: string }): Promise<IoResponse> {
  if (!source.pointer && !source.algo) throw new ComputeError('Provide a Hops pointer URL or .gh/.ghx file', 400);
  return computePost<IoResponse>('io', {
    algo: source.algo ?? null,
    pointer: source.pointer ?? null,
    modelunits: 'millimeters',
    dataversion: 1,
    absolutetolerance: 0.1,
    angletolerance: 1,
  });
}

export function solveDefinition(request: GrasshopperSolveRequest): Promise<GrasshopperSolveResponse> {
  return computePost<GrasshopperSolveResponse>('grasshopper', request);
}
