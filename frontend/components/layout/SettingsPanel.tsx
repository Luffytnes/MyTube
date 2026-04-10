'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Sun, Moon, Monitor, Upload, Wifi, WifiOff, AlertCircle, Loader2, Shield, RefreshCw, MapPin } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/lib/themeContext'
import { useRegion, REGIONS } from '@/lib/regionContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'

interface VpnState {
  status: VpnStatus
  conf_loaded: boolean
  conf_name: string | null
  error: string | null
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
  const { mode, theme, setMode } = useTheme()
  const { region, setRegion, t } = useRegion()
  const [vpn, setVpn] = useState<VpnState>({ status: 'disconnected', conf_loaded: false, conf_name: null, error: null })
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [ipLoading, setIpLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchIpInfo = useCallback(async () => {
    setIpLoading(true)
    setIpInfo(null)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/myip`)
      if (res.ok) setIpInfo(await res.json())
    } catch {}
    setIpLoading(false)
  }, [])

  // Fetch VPN status when panel opens
  useEffect(() => {
    if (!open) return
    fetchVpnStatus()
    fetchIpInfo()
  }, [open, fetchIpInfo])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
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

  async function fetchVpnStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/vpn/status`)
      if (res.ok) {
        const data = await res.json()
        setVpn({
          status: data.running ? 'connected' : 'disconnected',
          conf_loaded: data.conf_loaded,
          conf_name: data.conf_name ?? null,
          error: data.error ?? null,
        })
      }
    } catch {}
  }

  async function handleUploadConf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/api/vpn/upload`, { method: 'POST', body: formData })
      if (res.ok) {
        setVpn((prev) => ({ ...prev, conf_loaded: true, conf_name: file.name, error: null }))
      } else {
        const data = await res.json().catch(() => ({}))
        setVpn((prev) => ({ ...prev, error: data.detail ?? t('settings_vpn_error') }))
      }
    } catch {
      setVpn((prev) => ({ ...prev, error: t('settings_vpn_error') }))
    }
    // Reset so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = ''
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

  const vpnConnected = vpn.status === 'connected'
  const vpnBusy = vpn.status === 'connecting' || vpn.status === 'disconnecting'

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />

      {/* Sliding panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 bottom-0 z-50 w-80 bg-yt-bg border-l border-yt-border shadow-2xl flex flex-col transition-transform duration-250 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-yt-border/50">
          <h2 className="text-yt-text font-semibold text-base">{t('settings_title')}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-yt-hover text-yt-text-secondary hover:text-yt-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-6 px-5">
          {/* ── Apparence ── */}
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

          <div className="border-t border-yt-border/40" />

          {/* ── Langue & Région ── */}
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

          <div className="border-t border-yt-border/40" />

          {/* ── VPN WireGuard ── */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest">{t('settings_vpn')}</p>
              {vpnConnected && <Shield className="w-3.5 h-3.5 text-green-400" />}
            </div>
            <p className="text-xs text-yt-text-muted mb-4 leading-relaxed">{t('settings_vpn_desc')}</p>

            {/* Config file */}
            <div className="mb-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".conf"
                className="hidden"
                onChange={handleUploadConf}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-yt-border/60 text-sm text-yt-text-secondary hover:bg-yt-hover hover:text-yt-text transition-colors"
              >
                <Upload className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">
                  {vpn.conf_name ?? t('settings_vpn_upload')}
                </span>
              </button>
              {vpn.conf_loaded && !vpn.conf_name && (
                <p className="text-xs text-green-400 mt-1 px-1">{t('settings_vpn_conf_loaded')}</p>
              )}
            </div>

            {/* Status + toggle */}
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 text-xs font-medium flex-1 ${
                vpnConnected ? 'text-green-400' : vpn.status === 'error' ? 'text-red-400' : 'text-yt-text-muted'
              }`}>
                {vpnBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : vpnConnected ? (
                  <Wifi className="w-3.5 h-3.5" />
                ) : vpn.status === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5" />
                )}
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
                disabled={vpnBusy || (!vpn.conf_loaded && !vpnConnected)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  vpnConnected
                    ? 'bg-yt-hover border border-yt-border text-yt-text hover:border-red-400 hover:text-red-400'
                    : 'bg-yt-red hover:bg-yt-red-hover text-white'
                }`}
              >
                {vpnConnected ? t('settings_vpn_disconnect') : t('settings_vpn_connect')}
              </button>
            </div>

            {vpn.error && (
              <p className="text-xs text-red-400 mt-2 px-1">{vpn.error}</p>
            )}

            {/* IP visible */}
            <div className="mt-4 pt-4 border-t border-yt-border/40">
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
                    {ipInfo.org && (
                      <div className="opacity-60 mt-0.5 truncate">{ipInfo.org}</div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-yt-text-muted">{t('settings_vpn_myip_error')}</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
