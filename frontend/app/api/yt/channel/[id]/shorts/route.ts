import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseShortsLockup, parseLockupView } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const yt = await getInnertube()
    const ch = await yt.getChannel(id)
    const feed = await ch.getShorts()

    const channelId = id
    const videos = (feed.videos ?? [])
      .map((v: any) => v?.type === 'ShortsLockupView' ? parseShortsLockup(v) : parseLockupView(v))
      .filter(Boolean)
      .map(v => ({ ...v!, channel: { ...v!.channel, id: v!.channel.id || channelId, thumbnail: v!.channel.thumbnail ?? `/api/channel_thumbnail/${channelId}` } }))

    return NextResponse.json({ videos, channelId })
  } catch (err: any) {
    console.error('[yt/channel/shorts]', err?.message)
    return NextResponse.json({ videos: [], channelId: id }, { status: 200 })
  }
}
