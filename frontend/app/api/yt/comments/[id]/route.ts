import { NextRequest, NextResponse } from 'next/server'
import { getInnertube } from '@/lib/innertube'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sort = (req.nextUrl.searchParams.get('sort') ?? 'TOP_COMMENTS') as 'TOP_COMMENTS' | 'NEWEST_FIRST'

  try {
    const yt = await getInnertube()
    const comments = await yt.getComments(params.id, sort)

    const totalCount: string =
      (comments.header as any)?.comments_count?.text ??
      (comments.header as any)?.count?.text ??
      ''

    const items = comments.contents
      .map((thread: any) => {
        const c = thread?.comment
        if (!c) return null
        return {
          id: c.comment_id ?? '',
          author: {
            name: c.author?.name?.toString?.() ?? '',
            thumbnail:
              c.creator_thumbnail_url ??
              c.author?.thumbnails?.[0]?.url ??
              null,
            isOwner: c.author_is_channel_owner ?? false,
          },
          content: c.content?.toString?.() ?? '',
          likeCount: c.like_count ?? '',
          replyCount: c.reply_count ?? '',
          publishedTime: c.published_time ?? '',
          isPinned: c.is_pinned ?? false,
          isHearted: c.is_hearted ?? false,
          hasReplies: thread.has_replies ?? false,
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      totalCount,
      comments: items,
      hasMore: comments.has_continuation ?? false,
    })
  } catch (err: any) {
    console.error('[yt/comments]', err?.message)
    return NextResponse.json({ totalCount: '', comments: [], hasMore: false })
  }
}
