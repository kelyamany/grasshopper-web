import { NextResponse } from 'next/server';
import { computePost, ComputeError } from '@/lib/compute/client';
import { computeErrorResponse, readJsonBody } from '@/lib/compute/http';

const ALLOWED_PREFIXES = ['rhino/geometry/'];

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ endpoint?: string; args?: unknown[] }>(request);
    const endpoint = String(body.endpoint ?? '').replace(/^\/+/, '');
    if (!ALLOWED_PREFIXES.some(prefix => endpoint.startsWith(prefix))) throw new ComputeError('Compute endpoint is not allowed', 400);
    if (!Array.isArray(body.args)) throw new ComputeError('args must be an array', 400);
    return NextResponse.json({ result: await computePost<unknown>(endpoint, body.args) });
  } catch (error) { return computeErrorResponse(error); }
}
