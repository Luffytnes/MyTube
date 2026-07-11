import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, fmtDuration, fmtViews, parseAnyVideo } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const yt = await getInnertube()
    const info = await yt.getInfo(params.id)
    const basic = info.basic_info

    // Build formats list
    const formats: any[] = []
    const seen = new Set<number>()
    const allFmts = [
      ...(info.streaming_data?.formats ?? []),
      ...(info.streaming_data?.adaptive_formats ?? []),
    ]
    for (const fmt of allFmts) {
      const itag = (fmt as any).itag
      if (seen.has(itag)) continue
      seen.add(itag)
      const mime = (fmt as any).mime_type ?? ''
      const isVideo = mime.startsWith('video/')
      const isAudio = mime.startsWith('audio/')
      if (!isVideo && !isAudio) continue
      const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'unknown'
      const height = (fmt as any).height ?? 0
      const bitrate = (fmt as any).bitrate ?? (fmt as any).average_bitrate ?? 0
      const qualLabel = (fmt as any).quality_label ?? (fmt as any).quality ?? ''
      const quality = isVideo && height ? `${height}p` : isVideo && qualLabel ? qualLabel : isAudio && bitrate ? `${Math.round(bitrate / 1000)}k audio` : 'audio'
      const isProgressive = isVideo && (fmt as any).audio_quality != null
      formats.push({
        itag: String(itag),
        ext,
        quality,
        filesize: (fmt as any).content_length ? Number((fmt as any).content_length) : null,
        hasAudio: isAudio || isProgressive,
        hasVideo: isVideo,
        height,
        abr: isAudio && bitrate ? Math.round(bitrate / 1000) : 0,
      })
    }
    formats.sort((a, b) => {
      const ka = a.hasVideo && a.hasAudio ? 0 : a.hasVideo ? 1 : 2
      const kb = b.hasVideo && b.hasAudio ? 0 : b.hasVideo ? 1 : 2
      if (ka !== kb) return ka - kb
      return (b.height ?? 0) - (a.height ?? 0)
    })

    // Related videos from watch_next_feed
    const related: any[] = []
    for (const item of (info.watch_next_feed ?? []).slice(0, 25)) {
      const card = parseAnyVideo(item)
      if (card) related.push(card)
    }

    const viewCount = basic.view_count ?? 0
    const likeCount = basic.like_count ?? 0

    return NextResponse.json({
      id: params.id,
      title: basic.title ?? '',
      description: basic.short_description ?? (basic as any).description ?? '',
      channel: basic.channel?.name ?? '',
      channelId: basic.channel?.id ?? '',
      thumbnail: `https://i.ytimg.com/vi/${params.id}/hqdefault.jpg`,
      duration: fmtDuration(basic.duration),
      views: fmtViews(viewCount),
      viewCount,
      likes: likeCount >= 1e6 ? `${(likeCount / 1e6).toFixed(1)}M` : likeCount >= 1e3 ? `${(likeCount / 1e3).toFixed(1)}K` : String(likeCount),
      uploadDate: (basic as any).publish_date ?? (basic as any).upload_date ?? '',
      isLive: basic.is_live ?? false,
      formats,
      related,
    })
  } catch (err: any) {
    console.error('[yt/video]', err?.message)
    return NextResponse.json({ detail: err?.message ?? 'Video not found' }, { status: 404 })
  }
}
