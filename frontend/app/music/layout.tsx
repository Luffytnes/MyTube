import MusicHeader from '@/components/music/MusicHeader'
import MusicSidebar from '@/components/music/MusicSidebar'
import MusicPlayer from '@/components/music/MusicPlayer'
import type { ReactNode } from 'react'

export default function MusicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MusicHeader />
      <MusicSidebar />
      {/* pt-14 (header) + pb-20 (player) + md:ml-20 xl:ml-56 (sidebar) */}
      <main className="pt-14 pb-32 ml-0 md:ml-20 xl:ml-56 min-h-screen">
        {children}
      </main>
      <MusicPlayer />
    </>
  )
}
