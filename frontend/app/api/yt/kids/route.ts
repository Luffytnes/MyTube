import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseCompactVideo } from '@/lib/innertube'

const KIDS_QUERIES: Record<string, string> = {
  all: 'cartoons kids',
  cartoons: 'cartoons animation kids',
  education: 'educational videos for kids',
  music: 'kids songs nursery rhymes',
  stories: 'stories for kids bedtime',
  science: 'science for kids experiments',
}

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') ?? 'all'
  try {
    const yt = await getInnertube()
    const query = KIDS_QUERIES[category] ?? KIDS_QUERIES.all

    const results = await yt.kids.search(query)
    const videos = (results.videos ?? [])
      .map(parseCompactVideo)
      .filter(Boolean)

    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/kids]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
