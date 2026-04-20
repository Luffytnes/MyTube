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
        <main className="flex-1 min-w-0 ml-0 md:ml-20 xl:ml-56 pb-14 md:pb-0">
          {children}
        </main>
      </div>
    </>
  )
}
