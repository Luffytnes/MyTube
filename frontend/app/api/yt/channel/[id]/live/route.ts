import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseLockupView } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const yt = await getInnertube()
    const ch = await yt.getChannel(params.id)
    const feed = await ch.getLiveStreams()
    const videos = (feed.videos ?? []).map(parseLockupView).filter(Boolean)
    return NextResponse.json({ videos, channelId: params.id })
  } catch (err: any) {
    console.error('[yt/channel/live]', err?.message)
    return NextResponse.json({ videos: [], channelId: params.id }, { status: 200 })
  }
}
