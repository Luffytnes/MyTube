import { NextRequest, NextResponse } from 'next/server'
import { getInnertube, parseCompactVideo } from '@/lib/innertube'

type Lang = 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'ja' | 'ko' | 'ru'

const QUERIES: Record<Lang, Record<string, string>> = {
  en: { all: 'kids cartoons for children', cartoons: 'cartoon kids animation', education: 'educational videos for kids', music: 'kids songs nursery rhymes', stories: 'bedtime stories for kids', science: 'science for kids experiments' },
  fr: { all: 'dessins animés pour enfants', cartoons: 'dessins animés enfants', education: 'vidéos éducatives enfants', music: 'chansons pour enfants comptines', stories: 'histoires du soir pour enfants', science: 'sciences pour enfants expériences' },
  es: { all: 'dibujos animados para niños', cartoons: 'dibujos animados infantiles', education: 'videos educativos para niños', music: 'canciones para niños', stories: 'cuentos para niños', science: 'ciencias para niños experimentos' },
  de: { all: 'zeichentrick für kinder', cartoons: 'zeichentrickfilme kinder', education: 'lernvideos für kinder', music: 'kinderlieder', stories: 'gute nacht geschichten kinder', science: 'wissenschaft für kinder experimente' },
  pt: { all: 'desenhos animados para crianças', cartoons: 'desenhos animados infantis', education: 'vídeos educativos para crianças', music: 'músicas infantis', stories: 'histórias para dormir crianças', science: 'ciências para crianças experimentos' },
  it: { all: 'cartoni animati per bambini', cartoons: 'cartoni animati infantili', education: 'video educativi per bambini', music: 'canzoni per bambini', stories: 'storie della buonanotte bambini', science: 'scienze per bambini esperimenti' },
  ja: { all: '子供向けアニメ', cartoons: '子供向けアニメ 人気', education: '子供向け教育動画', music: '童謡 子供の歌', stories: '子供向けおとぎ話', science: '子供向け科学実験' },
  ko: { all: '어린이 만화', cartoons: '어린이 애니메이션', education: '어린이 교육 영상', music: '어린이 노래 동요', stories: '어린이 동화 이야기', science: '어린이 과학 실험' },
  ru: { all: 'мультфильмы для детей', cartoons: 'мультики для детей', education: 'образовательные видео для детей', music: 'детские песни', stories: 'сказки для детей', science: 'наука для детей опыты' },
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
    const results = await yt.kids.search(query)
    const videos = (results.videos ?? []).map(parseCompactVideo).filter(Boolean)
    return NextResponse.json({ videos })
  } catch (err: any) {
    console.error('[yt/kids]', err?.message)
    return NextResponse.json({ videos: [] }, { status: 200 })
  }
}
