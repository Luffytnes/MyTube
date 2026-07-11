import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

const CATEGORY_QUERIES: Record<string, string> = {
  all: 'trending today',
  music: 'trending music',
  gaming: 'trending gaming',
  news: 'trending news',
  movies: 'trending movies trailers',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') ?? 'all'

  try {
    const yt = await getInnertube()
    const query = CATEGORY_QUERIES[category] ?? CATEGORY_QUERIES.all
    const results = await yt.search(query, { type: 'video' })
    const videos = (results.videos ?? []).map(parseVideoItem).filter(Boolean)
    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/trending]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
