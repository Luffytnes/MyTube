import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseLockupView } from '@/lib/innertube'
import { feedPage } from '@/lib/feedCache'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  try {
    const yt = await getInnertube()
    const feed = await feedPage(`channel-videos:${id}`, page, async () => (await yt.getChannel(id)).getVideos())
    // Past the last page: an empty list ends "Load more" (the old loop silently
    // fell back to page 1, so the same videos came back forever)
    if (!feed) return NextResponse.json({ videos: [], channelId: id, page })

    const channelId = id
    const videos = (feed.videos ?? [])
      .map(parseLockupView)
      .filter(Boolean)
      .map(v => ({
        ...v!,
        channel: {
          ...v!.channel,
          id: v!.channel.id || channelId,
          thumbnail: v!.channel.thumbnail ?? `/api/channel_thumbnail/${channelId}`,
        },
      }))
    return NextResponse.json({ videos, channelId, page })
  } catch (err: any) {
    console.error('[yt/channel/videos]', err?.message)
    return NextResponse.json({ videos: [], channelId: id, page }, { status: 200 })
  }
}
