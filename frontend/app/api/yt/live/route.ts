import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

const LIVE_QUERIES = [
  'news live stream',
  'live music concert',
  'sports live',
  'gaming live stream',
]

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') ?? 'all'
  try {
    const yt = await getInnertube()
    const query = category === 'music' ? 'live music concert'
                : category === 'gaming' ? 'gaming live stream'
                : category === 'news' ? 'news live stream'
                : category === 'sports' ? 'sports live stream'
                : 'live stream'

    const results = await yt.search(query, { type: 'video', features: ['live'] })
    const videos = (results.videos ?? [])
      .map(parseVideoItem)
      .filter(Boolean)
      .map((v: any) => ({ ...v, isLive: true }))

    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/live]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
