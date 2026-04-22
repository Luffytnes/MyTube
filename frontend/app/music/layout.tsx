import MusicHeader from '@/components/music/MusicHeader'
import MusicSidebar from '@/components/music/MusicSidebar'
import MusicPlayer from '@/components/music/MusicPlayer'
import type { ReactNode } from 'react'

export default function MusicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MusicHeader />
      <MusicSidebar />
      {/* pt-14 (header) + pb: mobile stacks player+music-nav+main-nav, desktop just player */}
      <main className="pt-14 md:pb-24 ml-0 md:ml-20 xl:ml-56 min-h-screen" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 190px)' }}>
        {children}
      </main>
      <MusicPlayer />
    </>
  )
}
