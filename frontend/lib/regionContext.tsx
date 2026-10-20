'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { translations, type Lang, type Translations } from './translations'
import { REGIONS, REGION_COOKIE, findRegion, type Region } from './regions'

export { REGIONS, type Region }

interface RegionContextValue {
  region: Region
  setRegion: (r: Region) => void
  t: (key: keyof Translations) => string
  lang: Lang
}

const RegionContext = createContext<RegionContextValue | null>(null)

const STORAGE_KEY = 'mytube-region'

function writeRegionCookie(code: string) {
  // Read by the root layout so the server renders in the user's language
  document.cookie = `${REGION_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`
}

export function RegionProvider({ children, initialRegionCode }: { children: ReactNode; initialRegionCode?: string }) {
  // Seeded from the cookie on the server: the first client render matches the
  // server HTML (Suspense boundaries hydrating late saw a different language).
  const [region, setRegionState] = useState<Region>(() => findRegion(initialRegionCode) ?? REGIONS[0])

  useEffect(() => {
    if (initialRegionCode) return
    // Choice saved before the cookie existed: migrate it once
    try {
      const found = findRegion(localStorage.getItem(STORAGE_KEY))
      if (found) {
        setRegionState(found)
        writeRegionCookie(found.code)
      }
    } catch {}
  }, [initialRegionCode])

  function setRegion(r: Region) {
    setRegionState(r)
    try { localStorage.setItem(STORAGE_KEY, r.code) } catch {}
    writeRegionCookie(r.code)
  }

  const lang = region.lang
  const t = (key: keyof Translations): string => translations[lang][key]

  return (
    <RegionContext.Provider value={{ region, setRegion, t, lang }}>
      {children}
    </RegionContext.Provider>
  )
}

export function useRegion() {
  const ctx = useContext(RegionContext)
  if (!ctx) throw new Error('useRegion must be used within RegionProvider')
  return ctx
}
