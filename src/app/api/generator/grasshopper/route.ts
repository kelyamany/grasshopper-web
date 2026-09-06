import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/compute/http';

interface GeneratedFile {
  name: string;
  mime?: string;
  base64: string;
}

interface GeneratorResponse {
  files?: GeneratedFile[];
  warnings?: string[];
  log?: string;
  error?: string;
  message?: string;
}

const MAX_SCRIPT_CHARS = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function targetUrl(): string | null {
  const value = process.env.GRASSHOPPER_GENERATOR_URL?.trim();
  return value ? value : null;
}

function safeFiles(value: unknown): GeneratedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const file = item as Partial<GeneratedFile>;
    if (!file.name || !file.base64) return [];
    return [{
      name: String(file.name).replace(/[\\/]+/g, '_'),
      mime: file.mime ? String(file.mime) : 'application/octet-stream',
      base64: String(file.base64),
    }];
  });
}

export async function POST(request: Request) {
  const url = targetUrl();
  if (!url) {
    return NextResponse.json({
      error: 'Grasshopper Python generator is not configured. Set GRASSHOPPER_GENERATOR_URL to a trusted Rhino/Grasshopper runner endpoint.',
    }, { status: 503 });
  }

  try {
    const body = await readJsonBody<{ script?: string; name?: string }>(request);
    const script = String(body.script ?? '');
    const name = String(body.name ?? 'grasshopper-catalog');

    if (!script.trim()) {
      return NextResponse.json({ error: 'Python generator script is empty.' }, { status: 400 });
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      return NextResponse.json({ error: 'Python generator script is too large.' }, { status: 413 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = process.env.GRASSHOPPER_GENERATOR_TOKEN?.trim();
    if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ script, name }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const raw = await response.text();
      let payload: GeneratorResponse = {};
      try {
        payload = raw ? JSON.parse(raw) as GeneratorResponse : {};
      } catch {
        return NextResponse.json({
          error: `Grasshopper generator returned invalid JSON (${response.status}).`,
          detail: raw.slice(0, 4000),
        }, { status: 502 });
      }

      if (!response.ok) {
        return NextResponse.json({
          error: payload.error ?? payload.message ?? `Grasshopper generator failed with HTTP ${response.status}.`,
          warnings: payload.warnings ?? [],
        }, { status: 502 });
      }

      const files = safeFiles(payload.files);
      if (!files.length) {
        return NextResponse.json({
          error: 'Grasshopper generator completed without returning downloadable files.',
          warnings: payload.warnings ?? [],
          log: payload.log ?? '',
        }, { status: 502 });
      }

      return NextResponse.json({
        files,
        warnings: payload.warnings ?? [],
        log: payload.log ?? '',
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Grasshopper generator timed out.' }, { status: 504 });
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
