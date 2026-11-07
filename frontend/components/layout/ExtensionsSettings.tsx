'use client'

import { useRegion } from '@/lib/regionContext'
import {
  EQ_BANDS, EQ_PRESETS, SPONSOR_CATEGORIES, SPONSOR_COLORS,
  setExtensions, useExtensions, type EqPreset, type ExtensionSettings,
} from '@/lib/extensions'

type TKey = Parameters<ReturnType<typeof useRegion>['t']>[0]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${on ? 'bg-yt-red' : 'bg-yt-border'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function Row({ title, desc, on, onChange, children }: {
  title: string; desc?: string; on: boolean; onChange: (v: boolean) => void; children?: React.ReactNode
}) {
  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-yt-text">{title}</p>
          {desc && <p className="text-xs text-yt-text-muted mt-0.5 leading-relaxed">{desc}</p>}
        </div>
        <Toggle on={on} onChange={onChange} label={title} />
      </div>
      {on && children}
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs font-semibold text-yt-text-muted uppercase tracking-widest mb-1">{title}</p>
      {desc && <p className="text-xs text-yt-text-muted mb-2">{desc}</p>}
      <div className="divide-y divide-yt-border/40">{children}</div>
    </section>
  )
}

function presetOf(gains: number[]): EqPreset | 'custom' {
  const found = (Object.keys(EQ_PRESETS) as EqPreset[]).find(name => EQ_PRESETS[name].every((g, i) => g === gains[i]))
  return found ?? 'custom'
}

/** Settings → Extensions: the optional player features (lib/extensions). */
export default function ExtensionsSettings() {
  const { t } = useRegion()
  const s = useExtensions()
  const set = (patch: Partial<ExtensionSettings>) => setExtensions(patch)
  const preset = presetOf(s.eqGains)

  return (
    <div className="space-y-6">
      <p className="text-sm text-yt-text-secondary">{t('ext_intro')}</p>

      <Section title="SponsorBlock">
        <Row title="SponsorBlock" desc={t('ext_sponsorblock_desc')} on={s.sponsorBlock} onChange={v => set({ sponsorBlock: v })}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-3">
            {SPONSOR_CATEGORIES.map(cat => (
              <label key={cat} className="flex items-center gap-2.5 py-1.5 cursor-pointer text-sm text-yt-text">
                <input
                  type="checkbox"
                  checked={s.sponsorCategories[cat]}
                  onChange={e => set({ sponsorCategories: { ...s.sponsorCategories, [cat]: e.target.checked } })}
                  className="w-4 h-4 accent-yt-red"
                />
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SPONSOR_COLORS[cat] }} />
                <span className="truncate">{t(`sponsor_cat_${cat}` as TKey)}</span>
              </label>
            ))}
          </div>
        </Row>
      </Section>

      <Section title={t('ext_player')}>
        <Row title={t('ext_seek_preview')} desc={t('ext_seek_preview_desc')} on={s.seekPreview} onChange={v => set({ seekPreview: v })} />
        <Row title={t('ext_exponential_volume')} desc={t('ext_exponential_volume_desc')} on={s.exponentialVolume} onChange={v => set({ exponentialVolume: v })} />
        <Row title={t('ext_wheel_volume')} desc={t('ext_wheel_volume_desc')} on={s.wheelVolume} onChange={v => set({ wheelVolume: v })} />
        <p className="text-xs text-yt-text-muted py-2 leading-relaxed">{t('ext_pip_note')}</p>
      </Section>

      <Section title={t('ext_sound')} desc={t('ext_sound_desc')}>
        <Row title={t('ext_normalize')} desc={t('ext_normalize_desc')} on={s.normalize} onChange={v => set({ normalize: v })} />
        <Row title={t('ext_equalizer')} on={s.equalizer} onChange={v => set({ equalizer: v })}>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-yt-text-muted">{t('ext_eq_preset')}</span>
              <select
                value={preset}
                onChange={e => { const name = e.target.value as EqPreset; if (EQ_PRESETS[name]) set({ eqGains: [...EQ_PRESETS[name]] }) }}
                className="flex-1 bg-yt-secondary border border-yt-border text-yt-text text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-yt-red cursor-pointer"
              >
                {(Object.keys(EQ_PRESETS) as EqPreset[]).map(name => (
                  <option key={name} value={name}>{t(`eq_preset_${name}` as TKey)}</option>
                ))}
                {preset === 'custom' && <option value="custom">{t('eq_preset_custom')}</option>}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
              {EQ_BANDS.map((freq, i) => (
                <label key={freq} className="flex items-center gap-2 py-0.5">
                  <span className="w-9 text-right text-[11px] tabular-nums text-yt-text-muted">{freq >= 1000 ? `${freq / 1000}k` : freq}</span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={s.eqGains[i]}
                    onChange={e => {
                      const gains = [...s.eqGains]
                      gains[i] = Number(e.target.value)
                      set({ eqGains: gains })
                    }}
                    aria-label={`${freq} Hz`}
                    className="flex-1 min-w-0 accent-yt-red cursor-pointer"
                  />
                  <span className="w-9 text-[11px] tabular-nums text-yt-text">{s.eqGains[i] > 0 ? '+' : ''}{s.eqGains[i]} dB</span>
                </label>
              ))}
            </div>
          </div>
        </Row>
      </Section>

      <Section title={t('ext_music')}>
        <Row title={t('ext_crossfade')} desc={t('ext_crossfade_desc')} on={s.crossfade} onChange={v => set({ crossfade: v })}>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs text-yt-text-muted">{t('ext_duration')}</span>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={s.crossfadeSeconds}
              onChange={e => set({ crossfadeSeconds: Number(e.target.value) })}
              className="flex-1 accent-yt-red cursor-pointer"
            />
            <span className="text-xs tabular-nums text-yt-text w-8 text-right">{s.crossfadeSeconds} s</span>
          </div>
        </Row>
        <Row title={t('ext_skip_silences')} desc={t('ext_skip_silences_desc')} on={s.skipSilences} onChange={v => set({ skipSilences: v })} />
        <Row title={t('ext_album_colors')} desc={t('ext_album_colors_desc')} on={s.albumColors} onChange={v => set({ albumColors: v })} />
        <Row title={t('ext_visualizer')} desc={t('ext_visualizer_desc')} on={s.visualizer} onChange={v => set({ visualizer: v })} />
      </Section>
    </div>
  )
}
