import { NextRequest, NextResponse } from 'next/server'
import { getInnertube } from '@/lib/innertube'
import type { Storyboard } from '@/lib/storyboard'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; storyboard: Storyboard | null }>()

/** Seek-bar preview sheets. The web clients' player responses no longer carry
 *  them; the mobile apps' still do. */
async function lookup(id: string): Promise<Storyboard | null> {
  const yt = await getInnertube()
  for (const client of ['IOS', 'ANDROID'] as const) {
    try {
      const info = await yt.getBasicInfo(id, { client })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const boards = ((info.storyboards as any)?.boards ?? []) as any[]
      // Largest frames up to 320 px: sharp in the tooltip, few sheets to load
      const board = boards
        .filter(b => b?.template_url && b.thumbnail_width <= 320 && b.thumbnail_count > 0 && b.columns > 0 && b.rows > 0)
        .sort((a, b) => b.thumbnail_width - a.thumbnail_width)[0]
      if (board) {
        return {
          templateUrl: board.template_url,
          width: board.thumbnail_width,
          height: board.thumbnail_height,
          count: board.thumbnail_count,
          interval: board.interval,
          columns: board.columns,
          rows: board.rows,
        }
      }
    } catch { /* try the next client */ }
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!VIDEO_ID.test(id)) return NextResponse.json({ detail: 'Invalid video id' }, { status: 400 })
  const hit = cache.get(id)
  let storyboard = hit && Date.now() - hit.at < TTL_MS ? hit.storyboard : undefined
  if (storyboard === undefined) {
    storyboard = await lookup(id)
    if (cache.size > 300) cache.delete(cache.keys().next().value!)
    cache.set(id, { at: Date.now(), storyboard })
  }
  return NextResponse.json({ storyboard }, { headers: { 'Cache-Control': 'private, max-age=1800' } })
}
