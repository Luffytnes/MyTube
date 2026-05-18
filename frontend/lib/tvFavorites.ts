const STORAGE_KEY = 'tv_favorites'

export type TvFavoriteType = 'live' | 'vod' | 'series'

export interface TvFavorite {
  id: string
  type: TvFavoriteType
  name: string
  icon: string
  ext?: string   // extension du fichier source (mp4, mkv, avi…)
  media?: string // "movie" | "series" — contexte Xtream
}

function load(): TvFavorite[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function save(favs: TvFavorite[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tvfavoriteschange'))
}

export function getTvFavorites(): TvFavorite[] {
  return load()
}

export function isTvFavorite(id: string, type: TvFavoriteType): boolean {
  return load().some(f => f.id === id && f.type === type)
}

export function addTvFavorite(fav: TvFavorite) {
  const favs = load().filter(f => !(f.id === fav.id && f.type === fav.type))
  save([fav, ...favs])
}

export function removeTvFavorite(id: string, type: TvFavoriteType) {
  save(load().filter(f => !(f.id === id && f.type === type)))
}

export function toggleTvFavorite(fav: TvFavorite): boolean {
  if (isTvFavorite(fav.id, fav.type)) {
    removeTvFavorite(fav.id, fav.type)
    return false
  }
  addTvFavorite(fav)
  return true
}
