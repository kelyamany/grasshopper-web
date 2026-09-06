import 'server-only';

import { NextResponse } from 'next/server';
import { ComputeError } from '@/lib/compute/client';

export function computeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ComputeError) {
    console.error('[GHWeb][API] Compute request failed', {
      status: error.status,
      message: error.message,
      stack: error.stack,
    });
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error('[GHWeb][API] Unexpected server error', {
    message,
    stack: error instanceof Error ? error.stack : undefined,
    error,
  });
  return NextResponse.json({ error: `Unexpected error: ${message}` }, { status: 500 });
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (error) {
    console.error('[GHWeb][API] Invalid JSON request body', {
      url: request.url,
      method: request.method,
      error,
    });
    throw new ComputeError('Request body must be valid JSON', 400);
  }
}
