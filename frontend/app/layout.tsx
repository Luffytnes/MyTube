import type { Metadata } from 'next'
import './globals.css'
import ClientLayoutWrapper from '@/components/layout/ClientLayoutWrapper'
import { RegionProvider } from '@/lib/regionContext'
import { SubscriptionsProvider } from '@/lib/subscriptionsContext'
import { ThemeProvider } from '@/lib/themeContext'
import { MusicProvider } from '@/lib/musicContext'

export const metadata: Metadata = {
  title: 'MyTube - Privacy-focused Video',
  description: 'A privacy-focused YouTube alternative. No tracking, no ads, no Google.',
  robots: 'noindex, nofollow',
  referrer: 'no-referrer',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="referrer" content="no-referrer" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
