import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseCount } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const yt = await getInnertube()
    const ch = await yt.getChannel(params.id)
    const meta = ch.metadata

    // Extract subscriber & video count from header metadata rows
    const headerRows: any[] = (ch.header as any)?.content?.metadata?.metadata_rows ?? []
    let subscriberText = ''
    let videoCountText = ''
    for (const row of headerRows) {
      for (const part of row?.metadata_parts ?? []) {
        const txt: string = part?.text?.text ?? ''
        if (!subscriberText && (txt.includes('subscriber') || txt.includes('abonné') || txt.match(/[KMB]\s*sub/i))) {
          subscriberText = txt
        } else if (!videoCountText && (txt.includes('video') || txt.includes('vidéo'))) {
          videoCountText = txt
        }
      }
    }

    return NextResponse.json({
      id: params.id,
      name: meta?.title ?? '',
      description: meta?.description ?? '',
      subscriberCount: parseCount(subscriberText),
      videoCount: parseCount(videoCountText),
      thumbnail: `/api/channel_thumbnail/${params.id}`,
      banner: `/api/channel_banner/${params.id}`,
      hasShorts: ch.has_shorts ?? false,
      hasLive: (ch as any).has_live_streams ?? (ch as any).has_live ?? false,
    })
  } catch (err: any) {
    console.error('[yt/channel]', err?.message)
    return NextResponse.json({ detail: err?.message ?? 'Channel not found' }, { status: 404 })
  }
}
