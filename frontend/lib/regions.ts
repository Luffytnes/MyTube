import type { Lang } from './translations'

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

export const REGION_COOKIE = 'mytube-region'

export function findRegion(code?: string | null): Region | undefined {
  return code ? REGIONS.find((r) => r.code === code) : undefined
}
