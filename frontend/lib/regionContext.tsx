'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { translations, type Lang, type Translations } from './translations'

export interface Region {
  code: string
  flag: string
  name: string
  lang: Lang
}

export const REGIONS: Region[] = [
  { code: 'US', flag: '🇺🇸', name: 'United States', lang: 'en' },
  { code: 'GB', flag: '🇬🇧', name: 'United Kingdom', lang: 'en' },
  { code: 'CA', flag: '🇨🇦', name: 'Canada', lang: 'en' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia', lang: 'en' },
  { code: 'IN', flag: '🇮🇳', name: 'India', lang: 'en' },
  { code: 'FR', flag: '🇫🇷', name: 'France', lang: 'fr' },
  { code: 'BE', flag: '🇧🇪', name: 'Belgique', lang: 'fr' },
  { code: 'DE', flag: '🇩🇪', name: 'Deutschland', lang: 'de' },
  { code: 'AT', flag: '🇦🇹', name: 'Österreich', lang: 'de' },
  { code: 'ES', flag: '🇪🇸', name: 'España', lang: 'es' },
  { code: 'MX', flag: '🇲🇽', name: 'México', lang: 'es' },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', lang: 'es' },
  { code: 'IT', flag: '🇮🇹', name: 'Italia', lang: 'it' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', lang: 'pt' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal', lang: 'pt' },
  { code: 'JP', flag: '🇯🇵', name: '日本', lang: 'ja' },
  { code: 'KR', flag: '🇰🇷', name: '한국', lang: 'ko' },
  { code: 'RU', flag: '🇷🇺', name: 'Россия', lang: 'ru' },
  { code: 'NL', flag: '🇳🇱', name: 'Nederland', lang: 'en' },
  { code: 'PL', flag: '🇵🇱', name: 'Polska', lang: 'en' },
]

interface RegionContextValue {
  region: Region
  setRegion: (r: Region) => void
  t: (key: keyof Translations) => string
  lang: Lang
}

const RegionContext = createContext<RegionContextValue | null>(null)

const STORAGE_KEY = 'mytube-region'

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState<Region>(REGIONS[0])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const found = REGIONS.find((r) => r.code === saved)
        if (found) setRegionState(found)
      }
    } catch {}
  }, [])

  function setRegion(r: Region) {
    setRegionState(r)
    try { localStorage.setItem(STORAGE_KEY, r.code) } catch {}
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
