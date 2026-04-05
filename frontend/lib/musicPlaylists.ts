import type { MusicTrack } from './musicContext'

const KEY = 'mytube-music-playlists'

export interface MusicPlaylist {
  id: string
  name: string
  tracks: MusicTrack[]
  createdAt: number
  updatedAt: number
}

function load(): MusicPlaylist[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function save(playlists: MusicPlaylist[]) {
  try { localStorage.setItem(KEY, JSON.stringify(playlists)) } catch {}
}

export function getMusicPlaylists(): MusicPlaylist[] {
  return load()
}

export function getMusicPlaylist(id: string): MusicPlaylist | null {
  return load().find((p) => p.id === id) || null
}

export function createMusicPlaylist(name: string): MusicPlaylist {
  const playlist: MusicPlaylist = {
    id: `mp_${Date.now()}`,
    name,
    tracks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  save([...load(), playlist])
  return playlist
}

export function deleteMusicPlaylist(id: string): void {
  save(load().filter((p) => p.id !== id))
}

export function renameMusicPlaylist(id: string, name: string): void {
  save(load().map((p) => p.id === id ? { ...p, name, updatedAt: Date.now() } : p))
}

export function addTrackToPlaylist(playlistId: string, track: MusicTrack): void {
  save(load().map((p) => {
    if (p.id !== playlistId) return p
    if (p.tracks.some((t) => t.videoId === track.videoId)) return p
    return { ...p, tracks: [...p.tracks, track], updatedAt: Date.now() }
  }))
}

export function removeTrackFromPlaylist(playlistId: string, videoId: string): void {
  save(load().map((p) => {
    if (p.id !== playlistId) return p
    return { ...p, tracks: p.tracks.filter((t) => t.videoId !== videoId), updatedAt: Date.now() }
  }))
}

export function moveTrack(playlistId: string, fromIdx: number, toIdx: number): void {
  save(load().map((p) => {
    if (p.id !== playlistId) return p
    const tracks = [...p.tracks]
    const [moved] = tracks.splice(fromIdx, 1)
    tracks.splice(toIdx, 0, moved)
    return { ...p, tracks, updatedAt: Date.now() }
  }))
}
