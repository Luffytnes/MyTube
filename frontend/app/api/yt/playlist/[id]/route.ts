import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseLockupView } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const yt = await getInnertube()
    const pl = await yt.getPlaylist(params.id)

    const videos = (pl.items ?? [])
      .map((v: any) => parseLockupView(v))
      .filter(Boolean)
      .map((v: any, i: number) => ({
        id: v.id,
        title: v.title,
        duration: v.duration ?? '',
        thumbnail: v.thumbnail,
        channel: v.channel.name ?? '',
        channelId: v.channel.id ?? '',
        index: i + 1,
      }))

    return NextResponse.json({
      id: params.id,
      title: pl.info?.title ?? '',
      uploader: pl.info?.author?.name ?? '',
      videoCount: (pl as any).total_items ?? videos.length,
      videos,
    })
  } catch (err: any) {
    console.error('[yt/playlist]', err?.message)
    return NextResponse.json({ detail: err?.message ?? 'Playlist not found' }, { status: 404 })
  }
}
