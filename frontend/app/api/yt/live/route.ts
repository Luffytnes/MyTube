import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

type Lang = 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'ja' | 'ko' | 'ru'

const QUERIES: Record<Lang, Record<string, string>> = {
  en: { all: 'live stream now', news: 'news live stream', music: 'music concert live', gaming: 'gaming live stream', sports: 'sports live stream' },
  fr: { all: 'direct live maintenant', news: 'actualités en direct', music: 'concert direct live', gaming: 'gaming en direct', sports: 'sport direct live' },
  es: { all: 'transmisión en vivo ahora', news: 'noticias en vivo', music: 'concierto en vivo', gaming: 'gaming en vivo', sports: 'deportes en vivo' },
  de: { all: 'live stream jetzt', news: 'nachrichten live', music: 'konzert live stream', gaming: 'gaming live stream', sports: 'sport live stream' },
  pt: { all: 'ao vivo agora', news: 'notícias ao vivo', music: 'show ao vivo', gaming: 'gaming ao vivo', sports: 'esportes ao vivo' },
  it: { all: 'diretta live adesso', news: 'notizie in diretta', music: 'concerto in diretta', gaming: 'gaming in diretta', sports: 'sport in diretta' },
  ja: { all: 'ライブ配信 今', news: 'ニュース生放送', music: 'ライブコンサート', gaming: 'ゲーム実況 ライブ', sports: 'スポーツ生中継' },
  ko: { all: '라이브 방송 지금', news: '뉴스 생방송', music: '콘서트 라이브', gaming: '게임 라이브 방송', sports: '스포츠 생중계' },
  ru: { all: 'прямой эфир сейчас', news: 'новости прямой эфир', music: 'концерт прямой эфир', gaming: 'игры прямой эфир', sports: 'спорт прямой эфир' },
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
    const results = await yt.search(query, { type: 'video', features: ['live'] })
    const videos = (results.videos ?? [])
      .map(parseVideoItem)
      .filter(Boolean)
      .map((v: any) => ({ ...v, isLive: true }))
    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/live]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
