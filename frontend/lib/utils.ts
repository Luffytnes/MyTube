import clsx, { type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}

export function formatViews(n: number): string {
  if (!n && n !== 0) return '0 views'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B views`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`
  return `${n} views`
}

export function formatViewsShort(n: number): string {
  if (!n && n !== 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

export function formatDuration(seconds: number): string {
  if (!seconds && seconds !== 0) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return 'Unknown date'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) {
    const m = Math.floor(diff / 60)
    return `${m} minute${m !== 1 ? 's' : ''} ago`
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600)
    return `${h} hour${h !== 1 ? 's' : ''} ago`
  }
  if (diff < 2592000) {
    const d = Math.floor(diff / 86400)
    return `${d} day${d !== 1 ? 's' : ''} ago`
  }
  if (diff < 31536000) {
    const mo = Math.floor(diff / 2592000)
    return `${mo} month${mo !== 1 ? 's' : ''} ago`
  }
  const y = Math.floor(diff / 31536000)
  return `${y} year${y !== 1 ? 's' : ''} ago`
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`
  return `${bytes} B`
}

export function formatSubscribers(n: number): string {
  if (!n) return '0 subscribers'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M subscribers`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K subscribers`
  return `${n} subscribers`
}
