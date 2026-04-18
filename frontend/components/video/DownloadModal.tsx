'use client'

import { useState, useEffect } from 'react'
import { X, Download, FileVideo, Music, Loader2 } from 'lucide-react'
import { formatFileSize, cn } from '@/lib/utils'
import { getDownloadUrl, type VideoFormat } from '@/lib/api'
import { useRegion } from '@/lib/regionContext'

interface DownloadModalProps {
  videoId: string
  title: string
  formats: VideoFormat[]
  onClose: () => void
}


type FormatGroupKey = 'videoAudio' | 'videoOnly' | 'audioOnly'

function buildFormatGroups(formats: VideoFormat[]): { key: FormatGroupKey; icon: typeof FileVideo; formats: VideoFormat[] }[] {
  const groups = []
  // Video-only streams (1080p, 720p…) are merged with audio by ffmpeg server-side on download
  const videoAudio = formats.filter((f) => f.hasVideo)
  const audioOnly = formats.filter((f) => !f.hasVideo && f.hasAudio)
  if (videoAudio.length > 0) groups.push({ key: 'videoAudio' as const, icon: FileVideo, formats: videoAudio })
  if (audioOnly.length > 0) groups.push({ key: 'audioOnly' as const, icon: Music, formats: audioOnly })
  return groups
}

export default function DownloadModal({
  videoId,
  title,
  formats,
  onClose,
}: DownloadModalProps) {
  const { t } = useRegion()
  const [downloading, setDownloading] = useState<string | null>(null)
  const groups = buildFormatGroups(formats)

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  function handleDownload(fmt: VideoFormat) {
    if (downloading) return
    const itag = String(fmt.itag)
    setDownloading(itag)
    const url = getDownloadUrl(videoId, itag)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Reset after short delay
    setTimeout(() => setDownloading(null), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className="relative bg-yt-secondary border border-yt-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-yt-border">
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-yt-red" />
            <h2 className="text-yt-text font-semibold text-lg">{t('download_title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video title */}
        <div className="px-6 py-3 border-b border-yt-border/50 bg-yt-bg/40">
          <p className="text-sm text-yt-text line-clamp-2">{title}</p>
        </div>

        {/* Format groups */}
        <div className="overflow-y-auto flex-1 py-2">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-yt-text-muted">
              <p>{t('download_noFormats')}</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="mb-2">
                <div className="flex items-center gap-2 px-6 py-2">
                  <group.icon className="w-4 h-4 text-yt-text-muted" />
                  <h3 className="text-xs font-semibold text-yt-text-muted uppercase tracking-wider">
                    {group.key === 'videoAudio' ? t('download_videoAudio') : group.key === 'videoOnly' ? t('download_videoOnly') : t('download_audioOnly')}
                  </h3>
                </div>
                <div className="space-y-0.5">
                  {group.formats.map((fmt) => {
                    const isDownloading = downloading === String(fmt.itag)
                    return (
                      <div
                        key={fmt.itag}
                        className="flex items-center justify-between px-6 py-3 hover:bg-yt-hover transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="text-sm font-medium text-yt-text">
                              {fmt.quality}
                            </p>
                            <p className="text-xs text-yt-text-muted mt-0.5">
                              <span className="uppercase">{fmt.ext}</span>
                              {fmt.filesize && (
                                <span className="ml-2">
                                  {formatFileSize(fmt.filesize)}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownload(fmt)}
                          disabled={!!downloading}
                          className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                            isDownloading
                              ? 'bg-yt-border text-yt-text-muted cursor-not-allowed'
                              : 'bg-yt-red hover:bg-yt-red-hover text-white'
                          )}
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{t('download_starting')}</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>{t('download')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-yt-border bg-yt-bg/40">
          <p className="text-xs text-yt-text-muted text-center">{t('download_privacy')}</p>
        </div>
      </div>
    </div>
  )
}
