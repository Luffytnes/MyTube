import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseAnyVideo } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { tag: string } }
) {
  const tag = decodeURIComponent(params.tag).replace(/^#/, '')

  try {
    const yt = await getInnertube()
    const feed = await yt.getHashtag(`#${tag}`)

    const header = feed.header as any
    const hashtagText: string = header?.hashtag?.text ?? `#${tag}`
    const hashtagInfo: string = header?.hashtag_info?.text ?? ''

    const items = (feed.contents?.contents ?? [])
      .map((node: any) => {
        const inner = node?.content ?? node
        return parseAnyVideo(inner)
      })
      .filter(Boolean)

    return NextResponse.json({ tag: hashtagText, info: hashtagInfo, videos: items })
  } catch (err: any) {
    console.error('[yt/hashtag]', err?.message)
    return NextResponse.json({ tag: `#${tag}`, info: '', videos: [] })
  }
}
