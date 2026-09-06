import { NextResponse } from 'next/server';
import { solveDefinition } from '@/lib/compute/client';
import { computeErrorResponse, readJsonBody } from '@/lib/compute/http';
import type { ResthopperTree } from '@/lib/compute/types';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ pointer?: string; algo?: string; values?: ResthopperTree[]; settings?: { modelunits?: string; absolutetolerance?: number; angletolerance?: number } }>(request);
    if (!body.pointer && !body.algo) return NextResponse.json({ error: 'Hops source is not configured' }, { status: 400 });
    return NextResponse.json(await solveDefinition({
      algo: body.algo ?? null,
      pointer: body.pointer ?? null,
      values: body.values ?? [],
      modelunits: body.settings?.modelunits ?? 'millimeters',
      dataversion: 1,
      absolutetolerance: body.settings?.absolutetolerance ?? 0.1,
      angletolerance: body.settings?.angletolerance ?? 1,
    }));
  } catch (error) { return computeErrorResponse(error); }
}
