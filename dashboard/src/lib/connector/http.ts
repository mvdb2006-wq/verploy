import { NextResponse } from 'next/server'

export const MAX_BODY_BYTES = 1_000_000

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Leest de body als tekst met een harde limiet (de handtekening gaat over de exacte bytes). */
export async function readBody(req: Request): Promise<string | null> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > MAX_BODY_BYTES) return null
  const text = await req.text()
  return Buffer.byteLength(text) > MAX_BODY_BYTES ? null : text
}
