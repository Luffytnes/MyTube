'use client'

import { EQ_BANDS, getExtensions, onExtensionsChange, type ExtensionSettings } from '@/lib/extensions'

/** Shared Web Audio chain for every player of the tab:
 *  media elements → equalizer → leveller (compressor) → analyser → speakers.
 *
 *  Once an element is routed here it can never play directly again, so it is
 *  only attached when an effect is on, and never into a context the browser
 *  keeps suspended (that would silence it). Our media come from the API, which
 *  answers CORS, so the browser lets Web Audio read them. */

let ctx: AudioContext | null = null
let input: GainNode | null = null
let filters: BiquadFilterNode[] = []
let compressor: DynamicsCompressorNode | null = null
let makeup: GainNode | null = null
let analyser: AnalyserNode | null = null
const attached = new WeakSet<HTMLMediaElement>()

export function needsAudioGraph(s: ExtensionSettings = getExtensions()): boolean {
  return (s.equalizer && s.eqGains.some(g => g !== 0)) || s.normalize || s.visualizer || s.skipSilences
}

function applySettings(): void {
  if (!ctx || !compressor || !makeup) return
  const s = getExtensions()
  const now = ctx.currentTime
  filters.forEach((f, i) => f.gain.setTargetAtTime(s.equalizer ? s.eqGains[i] ?? 0 : 0, now, 0.05))
  if (s.normalize) {
    // Quiet parts come up, loud parts go down: steadier level between videos/songs
    compressor.threshold.setTargetAtTime(-30, now, 0.05)
    compressor.knee.setTargetAtTime(20, now, 0.05)
    compressor.ratio.setTargetAtTime(4, now, 0.05)
    compressor.attack.setTargetAtTime(0.01, now, 0.05)
    compressor.release.setTargetAtTime(0.3, now, 0.05)
    makeup.gain.setTargetAtTime(1.6, now, 0.05)
  } else {
    compressor.threshold.setTargetAtTime(0, now, 0.05)
    compressor.ratio.setTargetAtTime(1, now, 0.05)
    makeup.gain.setTargetAtTime(1, now, 0.05)
  }
}

function build(): AudioContext {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new AC()
  input = ctx.createGain()
  filters = EQ_BANDS.map((freq, i) => {
    const f = ctx!.createBiquadFilter()
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
    f.frequency.value = freq
    f.Q.value = 1.1
    return f
  })
  compressor = ctx.createDynamicsCompressor()
  makeup = ctx.createGain()
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.75
  let node: AudioNode = input
  for (const f of filters) { node.connect(f); node = f }
  node.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(analyser)
  analyser.connect(ctx.destination)
  applySettings()
  onExtensionsChange(applySettings)
  // A suspended context means silence for every attached element: wake it on
  // the next interaction (browsers only allow that after a click or key press)
  const wake = () => { if (ctx?.state === 'suspended') ctx.resume().catch(() => {}) }
  document.addEventListener('pointerdown', wake, true)
  document.addEventListener('keydown', wake, true)
  return ctx
}

async function running(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true
  try {
    await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, 300))])
  } catch { /* not allowed without a user gesture */ }
  // Re-read: resume() changed it after TypeScript narrowed the type above
  return (context.state as AudioContextState) === 'running'
}

/** Route `el` through the effects when one is enabled. Safe to call often
 *  (on every play): does nothing once attached, or while not possible. */
export async function attachAudioEffects(el: HTMLMediaElement | null): Promise<boolean> {
  if (!el || typeof window === 'undefined') return false
  if (attached.has(el)) return true
  if (!needsAudioGraph()) return false
  const context = ctx ?? build()
  if (!(await running(context)) || attached.has(el)) return attached.has(el)
  try {
    context.createMediaElementSource(el).connect(input!)
    attached.add(el)
    return true
  } catch {
    return false  // already owned by another context
  }
}

export function isAudioEffectsAttached(el: HTMLMediaElement | null): boolean {
  return !!el && attached.has(el)
}

/** Analyser of the shared chain (visualizer, silence detection), once audio flows through it. */
export function getAnalyser(): AnalyserNode | null {
  return ctx?.state === 'running' ? analyser : null
}

/** Current level in dBFS of what is playing through the chain. */
export function currentLevelDb(buffer: Float32Array<ArrayBuffer>): number | null {
  const a = getAnalyser()
  if (!a) return null
  a.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  const rms = Math.sqrt(sum / buffer.length)
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}
