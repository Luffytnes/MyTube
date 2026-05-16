import { Suspense } from 'react'
import TvHeader from '@/components/tv/TvHeader'
import TvSidebar from '@/components/tv/TvSidebar'
import type { ReactNode } from 'react'

export default function TvLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TvHeader />
      <Suspense>
        <TvSidebar />
      </Suspense>
      <main className="pt-14 ml-0 md:ml-20 xl:ml-56 min-h-screen" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
        {children}
      </main>
    </>
  )
}
