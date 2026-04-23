'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'

export default function ClientLayoutWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isMusic = pathname.startsWith('/music')

  if (isMusic) {
    return <>{children}</>
  }

  return (
    <>
      <Header />
      <div className="flex pt-14">
        <Sidebar />
        <main className="flex-1 min-w-0 ml-0 md:ml-[88px] xl:ml-[228px] md:pb-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}>
          {children}
        </main>
      </div>
    </>
  )
}
