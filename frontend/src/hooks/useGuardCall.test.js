import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORT_TIMEOUT_MS, useGuardCall } from './useGuardCall.js'

// A stand-in for the WebSocket client: records what the hook sends and lets tests
// push server messages or close the connection.
const h = vi.hoisted(() => ({ sockets: [], readyFails: false, scenario: null }))

vi.mock('../api.js', () => ({
  api: { scenario: vi.fn(() => (h.scenario ? Promise.resolve(h.scenario) : Promise.reject(new Error('down')))) },
  GuardSocket: class {
    constructor({ onMessage, onClose }) {
      this.onMessage = onMessage
      this.onClose = onClose
      this.sent = []
      this.closed = false
      this.ready = h.readyFails ? Promise.reject(new Error('refused')) : Promise.resolve()
      this.ready.catch(() => {})
      h.sockets.push(this)
    }
    start(opts) { this.sent.push(['start', opts]) }
    text(text, speaker) { this.sent.push(['text', text, speaker]) }
    stop() { this.sent.push(['stop']) }
    sendAudio() {}
    close() { this.closed = true }
  },
}))
vi.mock('../lib/tts.js', () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }))

const SCENARIO = { lang: 'en', lines: [{ delay: 0, speaker: 'caller', text: 'This is CBI.' }] }
const base = { lang: 'en', source: 'demo', scenario: 'x', user_name: '', family_phone: '', caller_number: '', use_l3: false }

function setup(settings = {}, opts = {}) {
  const onReport = vi.fn()
  const hook = renderHook(() => useGuardCall({ settings: { ...base, ...settings }, file: null, micReady: true, onReport, ...opts }))
  return { ...hook, onReport, call: () => hook.result.current }
}

beforeEach(() => {
  h.sockets.length = 0
  h.readyFails = false
  h.scenario = SCENARIO
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('useGuardCall start', () => {
  it('refuses a file source with no file, without opening a socket', async () => {
    const { call } = setup({ source: 'file' })
    let ok
    await act(async () => { ok = await call().start() })
    expect(ok).toBe(false)
    expect(call().active).toBe(false)
    expect(call().error).toBe('Choose an audio file first.')
    expect(h.sockets).toHaveLength(0)
  })

  it('refuses the mic when server speech-to-text is not ready', async () => {
    const { call } = setup({ source: 'mic' }, { micReady: false })
    await act(async () => { await call().start() })
    expect(call().active).toBe(false)
    expect(call().error).toMatch(/speech-to-text is not available/)
  })

  it('stays idle when the demo scenario cannot be fetched', async () => {
    h.scenario = null
    const { call } = setup()
    await act(async () => { await call().start() })
    expect(call().active).toBe(false)
    expect(call().error).toMatch(/Cannot reach/)
  })

  it('stays idle when the WebSocket cannot connect', async () => {
    h.readyFails = true
    const { call } = setup()
    await act(async () => { await call().start() })
    expect(call().active).toBe(false)
    expect(call().error).toMatch(/Cannot reach/)
  })

  it('goes live, sends start and plays the scenario lines', async () => {
    const { call } = setup({ lang: 'te' })
    let ok
    await act(async () => { ok = await call().start() })
    expect(ok).toBe(true)
    expect(call().active).toBe(true)
    const s = h.sockets[0]
    expect(s.sent[0]).toEqual(['start', expect.objectContaining({ lang: 'te' })])
    await act(async () => { vi.advanceTimersByTime(700) })
    expect(s.sent).toContainEqual(['text', 'This is CBI.', 'caller'])
  })
})

describe('useGuardCall during a call', () => {
  async function live(settings) {
    const t = setup(settings)
    await act(async () => { await t.call().start() })
    return { ...t, s: h.sockets[0] }
  }

  it('tracks updates and raises the overlay at level 2+', async () => {
    const { call, s } = await live()
    act(() => s.onMessage({ type: 'update', score: 70, level: 2, tactics: [], hard_rule: '', utterance: { t: 1, text: 'hi', speaker: 'caller' }, alert: { level: 2, message: 'm' } }))
    expect(call().state.score).toBe(70)
    expect(call().lines).toHaveLength(1)
    expect(call().overlay).toBe(true)
    act(() => call().dismissOverlay())
    expect(call().overlay).toBe(false)
  })

  it('hands the report over and ends the call', async () => {
    const { call, s, onReport } = await live()
    act(() => call().end())
    expect(s.sent).toContainEqual(['stop'])
    act(() => s.onMessage({ type: 'report', report: { call_id: 'c1' } }))
    expect(onReport).toHaveBeenCalledWith({ call_id: 'c1' })
    expect(call().active).toBe(false)
    expect(s.closed).toBe(true)
  })

  it('ends with a message when the connection drops', async () => {
    const { call, s } = await live()
    act(() => s.onClose())
    expect(call().active).toBe(false)
    expect(call().error).toMatch(/Connection to the server was lost/)
  })

  it('keeps a server error (e.g. busy) instead of the generic drop message', async () => {
    const { call, s } = await live()
    act(() => s.onMessage({ type: 'error', message: 'The server is busy' }))
    act(() => s.onClose())
    expect(call().error).toBe('The server is busy')
  })

  it('gives up if the report never arrives', async () => {
    const { call, onReport } = await live()
    act(() => call().end())
    expect(call().active).toBe(true)
    act(() => { vi.advanceTimersByTime(REPORT_TIMEOUT_MS + 1) })
    expect(call().active).toBe(false)
    expect(call().error).toMatch(/Connection to the server was lost/)
    expect(onReport).not.toHaveBeenCalled()
  })
})
