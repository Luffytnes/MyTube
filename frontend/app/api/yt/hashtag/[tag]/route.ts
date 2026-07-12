import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseAnyVideo } from '@/lib/innertube'

export async function GET(
  _req: NextRequest,
  { params }: { params: { tag: string } }
) {
  const tag = decodeURIComponent(params.tag).replace(/^#/, '')

  try {
    const yt = await getInnertube()
    const feed = await yt.getHashtag(tag)

    const header = feed.header as any
    // PageHeader (current): page_title or content.title; HashtagHeader (legacy): hashtag
    const hashtagText: string =
      header?.page_title ??
      header?.content?.title?.text ??
      header?.content?.title?.toString?.() ??
      header?.hashtag?.text ??
      `#${tag}`
    const hashtagInfo: string =
      header?.content?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text?.text ??
      header?.content?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text?.toString?.() ??
      header?.hashtag_info?.text ??
      ''

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
