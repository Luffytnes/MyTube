'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Heart, ThumbsUp, Pin, ArrowUpDown } from 'lucide-react'
import { useRegion } from '@/lib/regionContext'

interface CommentAuthor {
  name: string
  thumbnail: string | null
  isOwner: boolean
}

interface Comment {
  id: string
  author: CommentAuthor
  content: string
  likeCount: string
  replyCount: string
  publishedTime: string
  isPinned: boolean
  isHearted: boolean
  hasReplies: boolean
}

interface CommentsData {
  totalCount: string
  comments: Comment[]
  hasMore: boolean
}

function Avatar({ name, src, isOwner }: { name: string; src: string | null; isOwner?: boolean }) {
  const [failed, setFailed] = useState(false)
  const colors = ['#1a73e8', '#d93025', '#188038', '#e37400', '#8430ce', '#007b83']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const bg = colors[Math.abs(hash) % colors.length]

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`w-8 h-8 rounded-full object-cover flex-shrink-0 ${isOwner ? 'ring-2 ring-yt-red' : ''}`}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div
      className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white ${isOwner ? 'ring-2 ring-yt-red' : ''}`}
      style={{ background: bg }}
    >
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="flex gap-3">
      <Avatar name={comment.author.name} src={comment.author.thumbnail} isOwner={comment.author.isOwner} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${comment.author.isOwner ? 'text-yt-red' : 'text-yt-text'}`}>
            {comment.author.name}
          </span>
          {comment.author.isOwner && (
            <span className="text-[10px] bg-yt-red/20 text-yt-red px-1.5 py-0.5 rounded font-medium">Auteur</span>
          )}
          {comment.isPinned && (
            <span className="flex items-center gap-1 text-[10px] text-yt-text-muted">
              <Pin className="w-3 h-3" /> Épinglé
            </span>
          )}
          <span className="text-xs text-yt-text-muted">{comment.publishedTime}</span>
        </div>
        <p className="text-sm text-yt-text mt-1 whitespace-pre-wrap break-words leading-relaxed">
          {comment.content}
        </p>
        <div className="flex items-center gap-3 mt-2">
          {comment.likeCount && (
            <span className="flex items-center gap-1 text-xs text-yt-text-muted">
              <ThumbsUp className="w-3.5 h-3.5" />
              {comment.likeCount}
            </span>
          )}
          {comment.isHearted && (
            <span className="flex items-center gap-1 text-xs text-yt-red">
              <Heart className="w-3.5 h-3.5 fill-yt-red" />
            </span>
          )}
          {comment.hasReplies && comment.replyCount && (
            <span className="text-xs text-blue-400 font-medium">
              {comment.replyCount} réponse{parseInt(comment.replyCount) > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Comments({ videoId }: { videoId: string }) {
  const { t } = useRegion()
  const [data, setData] = useState<CommentsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [sort, setSort] = useState<'TOP_COMMENTS' | 'NEWEST_FIRST'>('TOP_COMMENTS')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(false)
    fetch(`/api/yt/comments/${videoId}?sort=${sort}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [videoId, sort, open])

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-yt-text font-semibold text-lg mb-4 hover:text-yt-text-secondary transition-colors"
      >
        <MessageSquare className="w-5 h-5" />
        {t('comments_title')}
        {data?.totalCount && (
          <span className="text-sm font-normal text-yt-text-muted">({data.totalCount})</span>
        )}
        <span className="text-sm font-normal text-yt-text-muted ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div>
          {/* Sort toggle */}
          {!loading && !error && data && data.comments.length > 0 && (
            <button
              onClick={() => setSort(s => s === 'TOP_COMMENTS' ? 'NEWEST_FIRST' : 'TOP_COMMENTS')}
              className="flex items-center gap-1.5 text-xs text-yt-text-muted hover:text-yt-text mb-4 transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sort === 'TOP_COMMENTS' ? t('comments_sort_top') : t('comments_sort_new')}
            </button>
          )}

          {loading && (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-yt-secondary flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-yt-secondary rounded w-32" />
                    <div className="h-3 bg-yt-secondary rounded w-full" />
                    <div className="h-3 bg-yt-secondary rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="text-yt-text-muted text-sm">{t('comments_error')}</p>
          )}

          {!loading && !error && data && (
            <>
              {data.comments.length === 0 ? (
                <p className="text-yt-text-muted text-sm">{t('comments_empty')}</p>
              ) : (
                <div className="space-y-5">
                  {data.comments.map(c => (
                    <CommentItem key={c.id} comment={c} />
                  ))}
                </div>
              )}
              {data.hasMore && (
                <p className="mt-4 text-xs text-yt-text-muted text-center">
                  {t('comments_more')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
