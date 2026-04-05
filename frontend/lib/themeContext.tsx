'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type ThemeMode = 'dark' | 'light' | 'auto'

interface ThemeContextType {
  mode: ThemeMode
  theme: 'dark' | 'light'  // resolved theme (auto → system preference)
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = (localStorage.getItem('mytube-theme') as ThemeMode) || 'dark'
    const resolved = resolveTheme(saved)
    setModeState(saved)
    setTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [])

  // Listen for system preference changes when in auto mode
  useEffect(() => {
    if (mode !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      const resolved = mq.matches ? 'dark' : 'light'
      setTheme(resolved)
      document.documentElement.setAttribute('data-theme', resolved)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  function setMode(next: ThemeMode) {
    const resolved = resolveTheme(next)
    setModeState(next)
    setTheme(resolved)
    localStorage.setItem('mytube-theme', next)
    document.documentElement.setAttribute('data-theme', resolved)
  }

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
