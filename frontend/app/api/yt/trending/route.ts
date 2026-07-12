import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseVideoItem } from '@/lib/innertube'

type Lang = 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'ja' | 'ko' | 'ru'

const QUERIES: Record<Lang, Record<string, string>> = {
  en: { all: 'trending today', music: 'trending music', gaming: 'trending gaming', news: 'trending news', movies: 'trending movies trailers' },
  fr: { all: 'tendances aujourd\'hui', music: 'musique tendance', gaming: 'jeux vidéo tendance', news: 'actualités tendance', movies: 'films tendance' },
  es: { all: 'tendencias hoy', music: 'música tendencia', gaming: 'videojuegos tendencia', news: 'noticias tendencia', movies: 'películas tendencia' },
  de: { all: 'trends heute', music: 'musik trends', gaming: 'gaming trends', news: 'nachrichten trends', movies: 'filme trends' },
  pt: { all: 'tendências hoje', music: 'música tendência', gaming: 'jogos tendência', news: 'notícias tendência', movies: 'filmes tendência' },
  it: { all: 'tendenze oggi', music: 'musica tendenze', gaming: 'gaming tendenze', news: 'notizie tendenze', movies: 'film tendenze' },
  ja: { all: '今日のトレンド', music: '音楽トレンド', gaming: 'ゲームトレンド', news: 'ニューストレンド', movies: '映画トレンド' },
  ko: { all: '오늘의 트렌드', music: '음악 트렌드', gaming: '게임 트렌드', news: '뉴스 트렌드', movies: '영화 트렌드' },
  ru: { all: 'тренды сегодня', music: 'музыка тренды', gaming: 'игры тренды', news: 'новости тренды', movies: 'фильмы тренды' },
}

const LANG_MAP: Record<string, Lang> = {
  en: 'en', fr: 'fr', es: 'es', de: 'de', pt: 'pt', it: 'it', ja: 'ja', ko: 'ko', ru: 'ru',
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') ?? 'all'
  const region = (searchParams.get('region') ?? 'US').toUpperCase()
  const langRaw = searchParams.get('lang') ?? 'en'
  const lang: Lang = LANG_MAP[langRaw] ?? 'en'

  try {
    const yt = await getInnertube(region, lang)
    const langQueries = QUERIES[lang] ?? QUERIES.en
    const query = langQueries[category] ?? langQueries.all
    const results = await yt.search(query, { type: 'video' })
    const videos = (results.videos ?? []).map(parseVideoItem).filter(Boolean)
    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/trending]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
