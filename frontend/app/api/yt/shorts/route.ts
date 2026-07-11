import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

const SHORTS_QUERIES: Record<string, string> = {
  all: 'short funny viral',
  funny: 'funny shorts',
  gaming: 'gaming shorts clips',
  music: 'music clips shorts',
  food: 'cooking food shorts',
  sports: 'sports clips shorts',
}

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') ?? 'all'
  try {
    const yt = await getInnertube()
    const query = SHORTS_QUERIES[category] ?? SHORTS_QUERIES.all

    const results = await yt.search(query, { type: 'video', duration: 'short' as any })
    const videos = (results.videos ?? [])
      .map(parseVideoItem)
      .filter(Boolean)
      .map((v: any) => ({ ...v, isShort: true }))

    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/shorts]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
