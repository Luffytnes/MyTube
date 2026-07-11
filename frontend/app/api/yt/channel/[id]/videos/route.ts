import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseLockupView } from '@/lib/innertube'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  try {
    const yt = await getInnertube()
    const ch = await yt.getChannel(params.id)
    let feed = await ch.getVideos()

    // Paginate through continuations
    for (let i = 1; i < page; i++) {
      if ((feed as any).has_continuation) {
        feed = await (feed as any).getContinuation()
      } else break
    }

    const videos = (feed.videos ?? []).map(parseLockupView).filter(Boolean)
    return NextResponse.json({ videos, channelId: params.id, page })
  } catch (err: any) {
    console.error('[yt/channel/videos]', err?.message)
    return NextResponse.json({ videos: [], channelId: params.id, page }, { status: 200 })
  }
}
