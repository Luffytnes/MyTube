'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, ListMusic, Trash2, Pencil, Check, X } from 'lucide-react'
import {
  getMusicPlaylists, createMusicPlaylist, deleteMusicPlaylist,
  renameMusicPlaylist, type MusicPlaylist,
} from '@/lib/musicPlaylists'

export default function MusicPlaylistsPage() {
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => { setPlaylists(getMusicPlaylists()) }, [])

  function handleCreate() {
    const name = newName.trim()
    if (!name) return
    createMusicPlaylist(name)
    setPlaylists(getMusicPlaylists())
    setNewName('')
    setCreating(false)
  }

  function handleDelete(id: string) {
    deleteMusicPlaylist(id)
    setPlaylists(getMusicPlaylists())
  }

  function handleRename(id: string) {
    const name = editName.trim()
    if (name) renameMusicPlaylist(id, name)
    setEditingId(null)
    setPlaylists(getMusicPlaylists())
  }

  function startEdit(p: MusicPlaylist) {
    setEditingId(p.id)
    setEditName(p.name)
  }

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-yt-text text-2xl font-bold flex items-center gap-3">
          <ListMusic className="w-7 h-7 text-yt-red" />
          Mes playlists
        </h1>
        <button
          onClick={() => { setCreating(true); setNewName('') }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouvelle playlist
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-yt-secondary rounded-xl">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
            placeholder="Nom de la playlist..."
            className="flex-1 bg-transparent text-sm text-yt-text placeholder-yt-text-muted focus:outline-none px-2"
          />
          <button onClick={handleCreate} className="p-1.5 rounded-full bg-yt-red text-white hover:bg-yt-red-hover transition-colors">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={() => setCreating(false)} className="p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {playlists.length === 0 && !creating ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ListMusic className="w-16 h-16 text-yt-text-muted mb-4" />
          <p className="text-yt-text text-lg font-medium mb-1">Aucune playlist</p>
          <p className="text-yt-text-muted text-sm">Crée ta première playlist pour organiser ta musique.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {playlists.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-yt-secondary transition-colors group">
              {/* Cover */}
              <Link href={`/music/playlists/${p.id}`} className="flex-shrink-0">
                <div className="w-14 h-14 rounded-xl bg-yt-hover flex items-center justify-center">
                  {p.tracks[0]?.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.tracks[0].thumbnail} alt="" className="w-full h-full object-cover rounded-xl" />
                  ) : (
                    <ListMusic className="w-6 h-6 text-yt-text-muted" />
                  )}
                </div>
              </Link>

              {/* Name */}
              <div className="flex-1 min-w-0">
                {editingId === p.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(p.id); if (e.key === 'Escape') setEditingId(null) }}
                      className="flex-1 bg-yt-bg border border-yt-border rounded-lg px-2 py-1 text-sm text-yt-text focus:outline-none"
                    />
                    <button onClick={() => handleRename(p.id)} className="p-1 rounded text-yt-red hover:bg-yt-hover transition-colors">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 rounded text-yt-text-muted hover:bg-yt-hover transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <Link href={`/music/playlists/${p.id}`}>
                    <p className="text-yt-text text-sm font-medium truncate hover:text-yt-red transition-colors">{p.name}</p>
                    <p className="text-yt-text-muted text-xs mt-0.5">{p.tracks.length} titre{p.tracks.length !== 1 ? 's' : ''}</p>
                  </Link>
                )}
              </div>

              {/* Actions */}
              {editingId !== p.id && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(p)} className="p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-colors" aria-label="Renommer">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-red-400 transition-colors" aria-label="Supprimer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
