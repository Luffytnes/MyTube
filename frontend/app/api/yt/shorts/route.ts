import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

type Lang = 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'ja' | 'ko' | 'ru'

const QUERIES: Record<Lang, Record<string, string>> = {
  en: { all: 'shorts viral', funny: 'funny shorts', gaming: 'gaming shorts clips', music: 'music shorts clips', food: 'cooking food shorts', sports: 'sports shorts clips' },
  fr: { all: 'shorts viraux', funny: 'shorts drôles humour', gaming: 'gaming shorts clips', music: 'musique shorts clips', food: 'cuisine shorts', sports: 'sport shorts clips' },
  es: { all: 'shorts virales', funny: 'shorts divertidos', gaming: 'gaming shorts clips', music: 'música shorts clips', food: 'cocina shorts', sports: 'deporte shorts clips' },
  de: { all: 'shorts viral', funny: 'lustige shorts', gaming: 'gaming shorts clips', music: 'musik shorts clips', food: 'kochen shorts', sports: 'sport shorts clips' },
  pt: { all: 'shorts virais', funny: 'shorts engraçados', gaming: 'gaming shorts clips', music: 'música shorts clips', food: 'culinária shorts', sports: 'esporte shorts clips' },
  it: { all: 'shorts virali', funny: 'shorts divertenti', gaming: 'gaming shorts clips', music: 'musica shorts clips', food: 'cucina shorts', sports: 'sport shorts clips' },
  ja: { all: 'ショート 人気', funny: 'ショート 面白い', gaming: 'ゲーム ショート', music: '音楽 ショート', food: '料理 ショート', sports: 'スポーツ ショート' },
  ko: { all: '쇼츠 인기', funny: '쇼츠 웃긴', gaming: '게임 쇼츠', music: '음악 쇼츠', food: '요리 쇼츠', sports: '스포츠 쇼츠' },
  ru: { all: 'shorts вирусное', funny: 'смешные shorts', gaming: 'игры shorts', music: 'музыка shorts', food: 'кулинария shorts', sports: 'спорт shorts' },
}

const LANG_MAP: Record<string, Lang> = {
  en: 'en', fr: 'fr', es: 'es', de: 'de', pt: 'pt', it: 'it', ja: 'ja', ko: 'ko', ru: 'ru',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') ?? 'all'
  const region = (searchParams.get('region') ?? 'US').toUpperCase()
  const lang: Lang = LANG_MAP[searchParams.get('lang') ?? ''] ?? 'en'

  try {
    const yt = await getInnertube(region, lang)
    const query = (QUERIES[lang] ?? QUERIES.en)[category] ?? (QUERIES[lang] ?? QUERIES.en).all
    const results = await yt.search(query, { type: 'video', duration: 'short' as any })
    const videos = (results.videos ?? [])
      .map(parseVideoItem)
      .filter(Boolean)
      .map((v: any) => ({ ...v, isShort: true }))
    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/shorts]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
