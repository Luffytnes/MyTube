'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Sun, Moon, Monitor, Upload, Wifi, WifiOff, AlertCircle, Loader2, Shield, RefreshCw, MapPin, Trash2, Check, Globe, Network, Play, Database, Download, CheckCircle2, Mic2, Eye, EyeOff } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/lib/themeContext'
import { useRegion, REGIONS } from '@/lib/regionContext'
import { getPlaybackSettings, setPlaybackSettings, type PlaybackSettings } from '@/lib/playbackSettings'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
type Tab = 'general' | 'playback' | 'data' | 'wireproxy' | 'podcast'

interface VpnState {
  status: VpnStatus
  conf_loaded: boolean
  conf_name: string | null
  error: string | null
  auto_mode: boolean
  all_failed: boolean
}

interface IpInfo {
  ip: string
  city?: string
  country?: string
  org?: string
}

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { mode, setMode } = useTheme()
  const { region, setRegion, t } = useRegion()
  const [tab, setTab] = useState<Tab>('general')
  const [pbSettings, setPbSettings] = useState<PlaybackSettings>(() => getPlaybackSettings())
  const [vpn, setVpn] = useState<VpnState>({ status: 'disconnected', conf_loaded: false, conf_name: null, error: null, auto_mode: false, all_failed: false })
  const [vpnLoading, setVpnLoading] = useState(false)
  const [savedConfigs, setSavedConfigs] = useState<string[]>([])
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [ipLoading, setIpLoading] = useState(false)
  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [clearConfirm, setClearConfirm] = useState<string | null>(null)
  const [piKey, setPiKey] = useState('')
  const [piSecret, setPiSecret] = useState('')
  const [piShowSecret, setPiShowSecret] = useState(false)
  const [piSaving, setPiSaving] = useState(false)
  const [piSaved, setPiSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const fetchIpInfo = useCallback(async () => {
    setIpLoading(true)
    setIpInfo(null)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/myip`)
      if (res.ok) setIpInfo(await res.json())
    } catch {}
    setIpLoading(false)
  }, [])

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/configs`)
      if (res.ok) {
        const data = await res.json()
        setSavedConfigs(data.configs ?? [])
      }
    } catch {}
  }, [])

  function updatePbSetting<K extends keyof PlaybackSettings>(key: K, value: PlaybackSettings[K]) {
    const updated = setPlaybackSettings({ [key]: value })
    setPbSettings(updated)
  }

  const fetchVpnStatus = useCallback(async () => {
    setVpnLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/status`)
      if (res.ok) {
        const data = await res.json()
        setVpn({
          status: data.running ? 'connected' : 'disconnected',
          conf_loaded: data.conf_loaded,
          conf_name: data.conf_name ?? null,
          error: data.error ?? null,
          auto_mode: data.auto_mode ?? false,
          all_failed: data.all_failed ?? false,
        })
      }
    } catch {}
    setVpnLoading(false)
  }, [])

  // Refresh everything when panel opens
  useEffect(() => {
    if (!open) return
    fetchVpnStatus()
    fetchIpInfo()
    fetchConfigs()
  }, [open, fetchVpnStatus, fetchIpInfo, fetchConfigs])

  // Refresh VPN status every time the Wireproxy tab becomes active
  useEffect(() => {
    if (!open || tab !== 'wireproxy') return
    fetchVpnStatus()
    fetchConfigs()
  }, [tab, open, fetchVpnStatus, fetchConfigs])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  async function handleUploadConf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/upload`, { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setVpn((prev) => ({ ...prev, conf_loaded: true, conf_name: data.conf_name ?? file.name, error: null }))
        if (data.configs) setSavedConfigs(data.configs)
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSelectConf(name: string) {
    if (vpn.conf_name === name) return
    try {
      const res = await fetch(`${API_BASE}/api/vpn/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setVpn((prev) => ({ ...prev, conf_loaded: true, conf_name: name, error: null }))
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
        fetchVpnStatus() // resync in case of state mismatch
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
  }

  async function handleDeleteConf(name: string) {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/configs/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSavedConfigs(data.configs ?? [])
        if (vpn.conf_name === name) {
          setVpn((prev) => ({ ...prev, conf_loaded: false, conf_name: null, error: null }))
        }
      } else {
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
  }

  async function handleVpnToggle() {
    if (vpn.status === 'connected') {
      setVpn((prev) => ({ ...prev, status: 'disconnecting', error: null }))
      try {
        const res = await fetch(`${API_BASE}/api/vpn/stop`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        setVpn((prev) => ({ ...prev, status: 'disconnected', error: data.error ?? null }))
        fetchIpInfo()
      } catch {
        setVpn((prev) => ({ ...prev, status: 'error', error: t('settings_vpn_error') }))
      }
    } else if (vpn.status === 'disconnected' && vpn.conf_loaded) {
      setVpn((prev) => ({ ...prev, status: 'connecting', error: null }))
      try {
        const res = await fetch(`${API_BASE}/api/vpn/start`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.running) {
          setVpn((prev) => ({ ...prev, status: 'connected', error: null }))
          fetchIpInfo()
        } else {
          setVpn((prev) => ({ ...prev, status: 'error', error: data.detail ?? data.error ?? t('settings_vpn_error') }))
        }
      } catch {
        setVpn((prev) => ({ ...prev, status: 'error', error: t('settings_vpn_error') }))
      }
    }
  }

  async function handleAutoModeToggle() {
    const next = !vpn.auto_mode
    try {
      const res = await fetch(`${API_BASE}/api/vpn/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (res.ok) setVpn((prev) => ({ ...prev, auto_mode: next, all_failed: false }))
    } catch {}
  }

  async function handleResetFailover() {
    try {
      await fetch(`${API_BASE}/api/vpn/reset_failover`, { method: 'POST' })
      setVpn((prev) => ({ ...prev, all_failed: false }))
    } catch {}
  }

  const vpnConnected = vpn.status === 'connected'
  const vpnBusy = vpn.status === 'connecting' || vpn.status === 'disconnecting'

  function handleExport() {
    const data: Record<string, unknown> = {}
    const keys = ['mytube-history', 'mytube-search-history', 'mytube-watch-later', 'mytube-likes', 'mytube-queue', 'mytube-resume-positions', 'mytube-saved-playlists', 'mytube-subscriptions', 'mytube-playback-settings']
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      if (raw) data[k] = JSON.parse(raw)
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mytube-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        for (const [k, v] of Object.entries(data)) {
          localStorage.setItem(k, JSON.stringify(v))
        }
        setImportStatus('ok')
        setPbSettings(getPlaybackSettings())
      } catch {
        setImportStatus('err')
      }
      setTimeout(() => setImportStatus('idle'), 3000)
    }
    reader.readAsText(file)
    if (importInputRef.current) importInputRef.current.value = ''
  }

  function handleClearSection(key: string) {
    if (clearConfirm !== key) { setClearConfirm(key); return }
    localStorage.removeItem(key)
    setClearConfirm(null)
  }

  // Load Podcast Index keys when tab opens
  useEffect(() => {
    if (tab !== 'podcast') return
    fetch(`${API_BASE}/api/podcasts/config`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setPiKey(d.key || '')
          setPiSecret(d.secret ? '••••••••' : '')
        }
      })
      .catch(() => {})
  }, [tab])

  async function handleSavePiKeys() {
    setPiSaving(true)
    try {
      await fetch(`${API_BASE}/api/podcasts/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: piKey, secret: piSecret === '••••••••' ? null : piSecret }),
      })
      setPiSaved(true)
      setTimeout(() => setPiSaved(false), 2000)
    } catch {}
    setPiSaving(false)
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'general',
      label: 'Général',
      icon: <Globe className="w-4 h-4" />,
    },
    {
      id: 'playback',
      label: t('settings_tab_playback'),
      icon: <Play className="w-4 h-4" />,
    },
    {
      id: 'data',
      label: t('settings_data_tab'),
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: 'podcast',
      label: 'Podcast',
      icon: <Mic2 className="w-4 h-4" />,
    },
    {
      id: 'wireproxy',
      label: 'Wireproxy',
      icon: <Network className="w-4 h-4" />,
      badge: vpnConnected ? (
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
      ) : (
        <span className="w-2 h-2 rounded-full bg-yt-text-muted/40 flex-shrink-0" />
      ),
    },
  ]

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative z-10 flex w-full max-w-2xl h-[560px] bg-yt-bg border border-yt-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Left tab bar */}
        <div className="w-44 flex-shrink-0 bg-yt-secondary border-r border-yt-border flex flex-col pt-4 pb-4">
          <p className="px-4 pb-3 text-xs font-semibold text-yt-text-muted uppercase tracking-widest">
            {t('settings_title')}
          </p>
          <nav className="flex flex-col gap-0.5 px-2">
            {TABS.map(({ id, label, icon, badge }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                  tab === id
                    ? 'bg-yt-hover text-yt-text'
                    : 'text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                }`}
              >
                <span className={tab === id ? 'text-yt-red' : 'text-yt-text-muted'}>{icon}</span>
                <span className="flex-1">{label}</span>
                {badge}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-yt-border/50">
            <h2 className="text-yt-text font-semibold text-base">
              {tab === 'general' ? 'Général' : tab === 'playback' ? t('settings_tab_playback') : tab === 'data' ? t('settings_data_tab') : tab === 'podcast' ? 'Podcast Index' : 'Wireproxy'}
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── GÉNÉRAL ── */}
            {tab === 'general' && (
              <>
                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">{t('settings_appearance')}</p>
                  <div className="flex items-center gap-3">
                    {mode === 'light' ? <Sun className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                      : mode === 'dark' ? <Moon className="w-4 h-4 text-yt-text-muted flex-shrink-0" />
                      : <Monitor className="w-4 h-4 text-yt-text-muted flex-shrink-0" />}
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ThemeMode)}
                      className="flex-1 bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      <option value="light">{t('theme_light')}</option>
                      <option value="dark">{t('theme_dark')}</option>
                      <option value="auto">{t('theme_auto')}</option>
                    </select>
                  </div>
                </section>

                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">{t('settings_language')}</p>
                  <select
                    value={region.code}
                    onChange={(e) => {
                      const r = REGIONS.find((r) => r.code === e.target.value)
                      if (r) setRegion(r)
                    }}
                    className="w-full bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-yt-red cursor-pointer"
                  >
                    {REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.flag} {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </section>

                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">Historique</p>
                  <div className="space-y-2">
                    {([
                      { key: 'historyEnabled', label: t('settings_history_watch') },
                      { key: 'searchHistoryEnabled', label: t('settings_history_search') },
                    ] as { key: 'historyEnabled' | 'searchHistoryEnabled'; label: string }[]).map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-1">
                        <span className="text-sm text-yt-text">{label}</span>
                        <button
                          onClick={() => updatePbSetting(key, !pbSettings[key])}
                          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${pbSettings[key] ? 'bg-yt-red' : 'bg-yt-border'}`}
                        >
                          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pbSettings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">{t('settings_tab_playback')}</p>
                  <div className="space-y-3">
                    {/* Hide watched */}
                    <div className="flex items-center justify-between gap-3 py-1">
                      <span className="text-sm text-yt-text">{t('settings_hide_watched')}</span>
                      <button
                        onClick={() => updatePbSetting('hideWatched', !pbSettings.hideWatched)}
                        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${pbSettings.hideWatched ? 'bg-yt-red' : 'bg-yt-border'}`}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pbSettings.hideWatched ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    {/* Grid density */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-yt-text flex-shrink-0">{t('settings_grid_density')}</span>
                      <select
                        value={pbSettings.gridDensity}
                        onChange={(e) => updatePbSetting('gridDensity', e.target.value as PlaybackSettings['gridDensity'])}
                        className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                      >
                        <option value="compact">{t('settings_density_compact')}</option>
                        <option value="normal">{t('settings_density_normal')}</option>
                        <option value="comfortable">{t('settings_density_comfortable')}</option>
                      </select>
                    </div>

                    {/* History TTL */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-yt-text flex-shrink-0">{t('settings_history_ttl')}</span>
                      <select
                        value={pbSettings.historyTTL}
                        onChange={(e) => updatePbSetting('historyTTL', parseInt(e.target.value))}
                        className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                      >
                        <option value={0}>{t('settings_history_ttl_forever')}</option>
                        <option value={7}>7 {t('settings_history_ttl_days')}</option>
                        <option value={30}>30 {t('settings_history_ttl_days')}</option>
                        <option value={90}>90 {t('settings_history_ttl_days')}</option>
                      </select>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ── LECTURE ── */}
            {tab === 'playback' && (
              <div className="space-y-0">
                {/* Toggles */}
                {([
                  { key: 'autoplay' as const, label: t('settings_playback_autoplay') },
                  { key: 'autoplayNext' as const, label: t('settings_playback_autoplay_next') },
                  { key: 'loop' as const, label: t('settings_playback_loop') },
                  { key: 'resumePlayback' as const, label: t('settings_playback_resume') },
                ] ).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-2.5 border-b border-yt-border/40">
                    <span className="text-sm text-yt-text">{label}</span>
                    <button
                      onClick={() => updatePbSetting(key, !pbSettings[key])}
                      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${pbSettings[key] ? 'bg-yt-red' : 'bg-yt-border'}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pbSettings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}

                {/* Quality */}
                <div className="py-2.5 border-b border-yt-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_quality')}</span>
                    <select
                      value={pbSettings.defaultQuality}
                      onChange={(e) => updatePbSetting('defaultQuality', e.target.value as PlaybackSettings['defaultQuality'])}
                      className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      <option value="auto">{t('settings_quality_auto')}</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                      <option value="360p">360p</option>
                      <option value="240p">240p</option>
                    </select>
                  </div>
                </div>

                {/* Subtitle lang */}
                <div className="py-2.5 border-b border-yt-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_subtitle_lang')}</span>
                    <select
                      value={pbSettings.subtitleLang}
                      onChange={(e) => updatePbSetting('subtitleLang', e.target.value)}
                      className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      <option value="off">{t('settings_playback_subtitle_off')}</option>
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                      <option value="de">Deutsch</option>
                      <option value="pt">Português</option>
                      <option value="it">Italiano</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                      <option value="ru">Русский</option>
                      <option value="ar">العربية</option>
                      <option value="zh">中文</option>
                    </select>
                  </div>
                </div>

                {/* Speed */}
                <div className="py-2.5 border-b border-yt-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_speed')}</span>
                    <select
                      value={pbSettings.defaultSpeed}
                      onChange={(e) => updatePbSetting('defaultSpeed', parseFloat(e.target.value))}
                      className="bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
                    >
                      {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                        <option key={s} value={s}>{s === 1 ? '1× (normal)' : `${s}×`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Volume */}
                <div className="py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-yt-text flex-shrink-0">{t('settings_playback_volume')}</span>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={pbSettings.defaultVolume}
                      onChange={(e) => updatePbSetting('defaultVolume', parseFloat(e.target.value))}
                      className="flex-1 h-1.5 cursor-pointer accent-yt-red"
                    />
                    <span className="text-sm text-yt-text w-10 text-right tabular-nums">
                      {Math.round(pbSettings.defaultVolume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── DONNÉES ── */}
            {tab === 'data' && (
              <div className="space-y-6">
                {/* Export / Import */}
                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">Export / Import</p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yt-secondary border border-yt-border text-yt-text text-sm hover:bg-yt-hover transition-colors"
                    >
                      <Download className="w-4 h-4 text-yt-text-muted" />
                      {t('settings_data_export')}
                    </button>
                    <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                    <button
                      onClick={() => importInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yt-secondary border border-yt-border text-yt-text text-sm hover:bg-yt-hover transition-colors"
                    >
                      <Upload className="w-4 h-4 text-yt-text-muted" />
                      {t('settings_data_import')}
                    </button>
                    {importStatus === 'ok' && (
                      <p className="flex items-center gap-1.5 text-xs text-green-400"><CheckCircle2 className="w-3.5 h-3.5" />{t('settings_data_import_ok')}</p>
                    )}
                    {importStatus === 'err' && (
                      <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{t('settings_data_import_err')}</p>
                    )}
                  </div>
                </section>

                {/* Clear sections */}
                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-3">Effacer</p>
                  <div className="space-y-1.5">
                    {([
                      { key: 'mytube-history', label: t('settings_data_clear_history') },
                      { key: 'mytube-search-history', label: t('settings_data_clear_search') },
                      { key: 'mytube-watch-later', label: t('settings_data_clear_watch_later') },
                      { key: 'mytube-likes', label: t('settings_data_clear_likes') },
                      { key: 'mytube-queue', label: t('settings_data_clear_queue') },
                      { key: 'mytube-resume-positions', label: t('settings_data_clear_resume') },
                    ]).map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-yt-secondary border border-yt-border/60">
                        <span className="text-sm text-yt-text">{label}</span>
                        <button
                          onClick={() => handleClearSection(key)}
                          className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors flex-shrink-0 ${
                            clearConfirm === key
                              ? 'bg-red-500 hover:bg-red-600 text-white'
                              : 'border border-yt-border text-yt-text-muted hover:text-red-400 hover:border-red-400'
                          }`}
                        >
                          {clearConfirm === key ? t('settings_data_clear_confirm') : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                  {clearConfirm && (
                    <button
                      onClick={() => setClearConfirm(null)}
                      className="mt-2 text-xs text-yt-text-muted hover:text-yt-text"
                    >
                      {t('autoplay_cancel')}
                    </button>
                  )}
                </section>
              </div>
            )}

            {/* ── PODCAST INDEX ── */}
            {tab === 'podcast' && (
              <div className="space-y-6">
                <section>
                  <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-1">Podcast Index API</p>
                  <p className="text-xs text-yt-text-muted mb-4">
                    Clé gratuite sur{' '}
                    <span className="text-yt-text font-medium">podcastindex.org/developer</span>
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-yt-text-muted mb-1">API Key</label>
                      <input
                        type="text"
                        value={piKey}
                        onChange={(e) => setPiKey(e.target.value)}
                        placeholder="Votre clé API"
                        className="w-full px-3 py-2 rounded-xl bg-yt-secondary border border-yt-border text-sm text-yt-text placeholder-yt-text-muted focus:outline-none focus:border-yt-red transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-yt-text-muted mb-1">API Secret</label>
                      <div className="relative">
                        <input
                          type={piShowSecret ? 'text' : 'password'}
                          value={piSecret}
                          onChange={(e) => setPiSecret(e.target.value)}
                          placeholder="Votre secret API"
                          className="w-full px-3 py-2 pr-10 rounded-xl bg-yt-secondary border border-yt-border text-sm text-yt-text placeholder-yt-text-muted focus:outline-none focus:border-yt-red transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setPiShowSecret((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-yt-text-muted hover:text-yt-text transition-colors"
                        >
                          {piShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={handleSavePiKeys}
                      disabled={piSaving || !piKey.trim() || !piSecret.trim()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yt-red hover:bg-yt-red-hover disabled:opacity-40 text-white text-sm font-medium transition-colors"
                    >
                      {piSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : piSaved ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      {piSaved ? 'Enregistré !' : 'Enregistrer'}
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* ── WIREPROXY ── */}
            {tab === 'wireproxy' && (
              <>
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest">{t('settings_vpn')}</p>
                    {vpnConnected && <Shield className="w-3.5 h-3.5 text-green-400" />}
                  </div>
                  <p className="text-xs text-yt-text-muted mb-4 leading-relaxed">{t('settings_vpn_desc')}</p>

                  {/* Saved configs list */}
                  <div className="mb-4 space-y-1.5">
                    <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-2">{t('settings_vpn_saved_configs')}</p>
                    {savedConfigs.length === 0 && (
                      <p className="text-xs text-yt-text-muted px-1 mb-2">{t('settings_vpn_no_saved')}</p>
                    )}
                    {savedConfigs.map((name) => {
                      const isActive = vpn.conf_name === name
                      const isRunning = vpnConnected && isActive
                      return (
                        <div
                          key={name}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors ${
                            isActive && isRunning
                              ? 'border-green-500 bg-green-500/10 text-yt-text'
                              : isActive
                              ? 'border-yt-border bg-yt-hover text-yt-text'
                              : 'border-yt-border/60 text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text'
                          }`}
                        >
                          {isActive && <Check className={`w-3.5 h-3.5 flex-shrink-0 ${isRunning ? 'text-green-400' : 'text-yt-text-muted'}`} />}
                          <span className="flex-1 truncate font-mono text-xs">{name}</span>
                          {!isActive && (
                            <button
                              onClick={() => handleSelectConf(name)}
                              disabled={vpnConnected || vpnLoading}
                              className="text-xs px-2 py-0.5 rounded-lg bg-yt-secondary hover:bg-yt-hover border border-yt-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              title={vpnConnected ? t('settings_vpn_switch_stop') : t('settings_vpn_select')}
                            >
                              {t('settings_vpn_select')}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteConf(name)}
                            disabled={isRunning}
                            className="p-1 rounded-lg text-yt-text-muted hover:text-red-400 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={t('settings_vpn_delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}

                    <input ref={fileInputRef} type="file" accept=".conf" className="hidden" onChange={handleUploadConf} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-yt-border/60 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text hover:border-yt-border transition-colors"
                    >
                      <Upload className="w-4 h-4 flex-shrink-0" />
                      <span>{t('settings_vpn_upload')}</span>
                    </button>
                  </div>

                  {/* Status + toggle */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`flex items-center gap-1.5 text-xs font-medium flex-1 ${
                      vpnConnected ? 'text-green-400' : vpn.status === 'error' ? 'text-red-400' : 'text-yt-text-muted'
                    }`}>
                      {vpnBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : vpnConnected ? <Wifi className="w-3.5 h-3.5" />
                        : vpn.status === 'error' ? <AlertCircle className="w-3.5 h-3.5" />
                        : <WifiOff className="w-3.5 h-3.5" />}
                      <span>
                        {vpn.status === 'connecting' ? t('settings_vpn_starting')
                          : vpn.status === 'disconnecting' ? t('settings_vpn_stopping')
                          : vpnConnected ? t('settings_vpn_connected')
                          : vpn.status === 'error' ? t('settings_vpn_error')
                          : t('settings_vpn_disconnected')}
                      </span>
                    </div>
                    <button
                      onClick={handleVpnToggle}
                      disabled={vpnLoading || vpnBusy || (!vpn.conf_loaded && !vpnConnected)}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        vpnConnected
                          ? 'bg-yt-hover border border-yt-border text-yt-text hover:border-red-400 hover:text-red-400'
                          : 'bg-yt-red hover:bg-yt-red-hover text-white'
                      }`}
                    >
                      {vpnConnected ? t('settings_vpn_disconnect') : t('settings_vpn_connect')}
                    </button>
                  </div>

                  {vpn.error && <p className="text-xs text-red-400 mb-3 px-1">{vpn.error}</p>}

                  {/* Auto failover toggle */}
                  <div className="flex items-center justify-between gap-3 py-2.5 border-t border-yt-border/40 mt-2">
                    <div className="min-w-0">
                      <p className="text-sm text-yt-text">{t('settings_vpn_auto_mode')}</p>
                      <p className="text-xs text-yt-text-muted mt-0.5">{t('settings_vpn_auto_mode_desc')}</p>
                    </div>
                    <button
                      onClick={handleAutoModeToggle}
                      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${vpn.auto_mode ? 'bg-yt-red' : 'bg-yt-border'}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${vpn.auto_mode ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* All failed banner */}
                  {vpn.all_failed && (
                    <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium">{t('settings_vpn_all_failed')}</p>
                        <button onClick={handleResetFailover} className="mt-1 underline hover:no-underline">
                          {t('settings_vpn_reset_failover')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* IP visible */}
                  <div className="pt-3 border-t border-yt-border/40">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest">{t('settings_vpn_myip')}</p>
                      <button
                        onClick={fetchIpInfo}
                        disabled={ipLoading}
                        className="p-1 rounded-full hover:bg-yt-hover text-yt-text-muted hover:text-yt-text transition-colors disabled:opacity-40"
                        title={t('settings_vpn_myip_refresh')}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${ipLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {ipLoading ? (
                      <div className="flex items-center gap-2 text-xs text-yt-text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>...</span>
                      </div>
                    ) : ipInfo ? (
                      <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 ${vpnConnected ? 'bg-green-400/10 text-green-400' : 'bg-yt-secondary text-yt-text-secondary'}`}>
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono font-semibold">{ipInfo.ip}</span>
                          {(ipInfo.city || ipInfo.country) && (
                            <span className="ml-1 opacity-80">— {[ipInfo.city, ipInfo.country].filter(Boolean).join(', ')}</span>
                          )}
                          {ipInfo.org && <div className="opacity-60 mt-0.5">{ipInfo.org}</div>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-yt-text-muted">{t('settings_vpn_myip_error')}</p>
                    )}
                  </div>
                </section>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
