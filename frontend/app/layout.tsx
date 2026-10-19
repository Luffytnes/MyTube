import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import '@fontsource-variable/bricolage-grotesque'
import './globals.css'
import ClientLayoutWrapper from '@/components/layout/ClientLayoutWrapper'
import { RegionProvider } from '@/lib/regionContext'
import { SubscriptionsProvider } from '@/lib/subscriptionsContext'
import { ThemeProvider } from '@/lib/themeContext'
import { MusicProvider } from '@/lib/musicContext'

export const metadata: Metadata = {
  title: 'MyTube',
  description: 'A privacy-focused YouTube alternative. No tracking, no ads, no Google.',
  robots: 'noindex, nofollow',
  referrer: 'no-referrer',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MyTube',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#080a0f',
}

// Applies the saved theme before first paint (ThemeProvider only runs after hydration)
const THEME_BOOTSTRAP = `try{var m=localStorage.getItem('mytube-theme')||'dark';var t=m==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;document.documentElement.setAttribute('data-theme',t)}catch(e){}`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <meta name="referrer" content="no-referrer" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MyTube" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-yt-bg text-yt-text antialiased">
        <ThemeProvider>
        <RegionProvider>
          <SubscriptionsProvider>
          <MusicProvider>
          <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
          </MusicProvider>
          </SubscriptionsProvider>
        </RegionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
