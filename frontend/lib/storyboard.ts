import { imageSrc } from '@/lib/thumbnails'

/** YouTube's seek-bar previews: sheets of `columns × rows` small frames, one
 *  frame every `interval` ms. `templateUrl` holds `$M` for the sheet number. */
export interface Storyboard {
  templateUrl: string
  width: number
  height: number
  count: number
  interval: number
  columns: number
  rows: number
}

export interface PreviewTile {
  url: string
  style: React.CSSProperties
  width: number
  height: number
}

/** Background style showing the frame at `time` of a video lasting `duration`,
 *  drawn `displayWidth` px wide. */
export function storyboardTile(board: Storyboard, time: number, duration: number, displayWidth: number): PreviewTile | null {
  if (board.count <= 0 || board.columns <= 0 || board.rows <= 0) return null
  const raw = board.interval > 0
    ? Math.floor((time * 1000) / board.interval)
    : duration > 0 ? Math.floor((time / duration) * board.count) : 0
  const index = Math.max(0, Math.min(board.count - 1, raw))
  const perSheet = board.columns * board.rows
  const sheet = Math.floor(index / perSheet)
  const inSheet = index % perSheet
  const scale = displayWidth / board.width
  const width = Math.round(board.width * scale)
  const height = Math.round(board.height * scale)
  const url = imageSrc(board.templateUrl.replace('$M', String(sheet)))!
  return {
    url,
    width,
    height,
    style: {
      width,
      height,
      backgroundImage: `url("${url}")`,
      backgroundSize: `${board.columns * width}px ${board.rows * height}px`,
      backgroundPosition: `-${(inSheet % board.columns) * width}px -${Math.floor(inSheet / board.columns) * height}px`,
    },
  }
}
