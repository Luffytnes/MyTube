'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { ListMusic, Play, X } from 'lucide-react'
import TrackRow from '@/components/music/TrackRow'
import { useMusic } from '@/lib/musicContext'
import {
  getMusicPlaylist, removeTrackFromPlaylist, type MusicPlaylist,
} from '@/lib/musicPlaylists'
import { useRegion } from '@/lib/regionContext'

export default function MusicPlaylistPage() {
  const { id } = useParams<{ id: string }>()
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null)
  const { playTrack } = useMusic()
  const { t } = useRegion()

  function refresh() { setPlaylist(getMusicPlaylist(id)) }

  useEffect(() => { refresh() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRemove(videoId: string) {
    removeTrackFromPlaylist(id, videoId)
    refresh()
  }

  if (!playlist) {
    return (
      <div className="flex flex-col items-center justify-center py-32 min-h-screen">
        <ListMusic className="w-16 h-16 text-yt-text-muted mb-4" />
        <p className="text-yt-text-muted">{t('music_playlist_not_found')}</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-6 mb-8">
        <div className="w-48 h-48 rounded-2xl overflow-hidden bg-yt-secondary flex-shrink-0 shadow-2xl self-center sm:self-start">
          {playlist.tracks[0]?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={playlist.tracks[0].thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ListMusic className="w-16 h-16 text-yt-text-muted" />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end min-w-0">
          <p className="text-yt-text-muted text-xs uppercase tracking-widest mb-1">{t('music_playlists_label')}</p>
          <h1 className="text-yt-text text-3xl font-bold mb-2">{playlist.name}</h1>
          <p className="text-yt-text-muted text-sm">{playlist.tracks.length} {playlist.tracks.length !== 1 ? t('music_tracks') : t('music_track')}</p>
          {playlist.tracks.length > 0 && (
            <button
              onClick={() => playTrack(playlist.tracks[0], playlist.tracks)}
              className="flex items-center gap-2 px-6 py-2.5 bg-yt-red hover:bg-yt-red-hover text-white rounded-full text-sm font-medium transition-colors mt-5 self-start"
            >
              <Play className="w-4 h-4 fill-white" />
              {t('music_listen')}
            </button>
          )}
        </div>
      </div>

      {playlist.tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ListMusic className="w-12 h-12 text-yt-text-muted mb-3" />
          <p className="text-yt-text-muted text-sm">{t('music_no_tracks')}</p>
          <p className="text-yt-text-muted text-xs mt-1">{t('music_add_tracks_hint')}</p>
        </div>
      ) : (
        <div className="bg-yt-secondary rounded-2xl py-2">
          {playlist.tracks.map((track, i) => (
            <div key={track.videoId} className="flex items-center group">
              <div className="flex-1 min-w-0">
                <TrackRow track={track} queue={playlist.tracks} index={i} showThumbnail showAlbum />
              </div>
              <button
                onClick={() => handleRemove(track.videoId)}
                className="mr-3 p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-yt-hover text-yt-text-muted hover:text-red-400 transition-all flex-shrink-0"
                aria-label={t('music_remove')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
