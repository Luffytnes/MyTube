'use client'

import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useRegion } from '@/lib/regionContext'
import Header from './Header'
import Sidebar from './Sidebar'

export default function ClientLayoutWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { lang } = useRegion()
  // Screen readers and hyphenation follow the UI language, not the static "en"
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const isMusic = pathname.startsWith('/music')
  const isTv = pathname.startsWith('/tv')

  if (isMusic || isTv) {
    return <>{children}</>
  }

  return (
    <>
      <Header />
      <div className="flex pt-14">
        <Sidebar />
        <main className="flex-1 min-w-0 ml-0 md:ml-20 xl:ml-56 md:pb-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}>
          {children}
        </main>
      </div>
    </>
  )
}
