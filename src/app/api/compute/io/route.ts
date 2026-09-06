import { NextResponse } from 'next/server';
import { inspectDefinition } from '@/lib/compute/client';
import { computeErrorResponse, readJsonBody } from '@/lib/compute/http';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ pointer?: string; algo?: string }>(request);
    return NextResponse.json(await inspectDefinition(body));
  } catch (error) { return computeErrorResponse(error); }
}
