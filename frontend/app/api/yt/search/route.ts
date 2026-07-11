import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  try {
    const yt = await getInnertube()
    const results = page > 1
      ? await (await yt.search(q, { type: 'video' })).getContinuation()
      : await yt.search(q, { type: 'video' })

    const videos = (results.videos ?? [])
      .map(parseVideoItem)
      .filter(Boolean)

    // Channel results from general search
    const channels: any[] = []
    const playlists: any[] = []

    // Try to extract channel/playlist from results if available
    if ((results as any).results) {
      for (const item of (results as any).results) {
        if (item?.type === 'Channel') {
          channels.push({
            type: 'channel',
            id: item.id ?? '',
            name: item.author?.name ?? item.name ?? '',
            thumbnail: null,
            description: item.description_snippet?.text ?? '',
            subscriberText: item.subscriber_count?.text ?? '',
            videoCountText: '',
          })
        }
      }
    }

    return NextResponse.json({ videos, channels, playlists, query: q, page })
  } catch (err: any) {
    console.error('[yt/search]', err?.message)
    return NextResponse.json({ videos: [], channels: [], playlists: [], query: q, page }, { status: 200 })
  }
}
