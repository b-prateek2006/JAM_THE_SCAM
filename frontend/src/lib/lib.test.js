import { describe, expect, it } from 'vitest'
import { callStatus, familyWhatsApp, fmtClock, hardRuleText } from './format.js'
import { LANGS, STRINGS, t } from './i18n.js'
import { hashFor, parseHash } from './route.js'
import { applyTheme } from './theme.js'
import {
  DEFAULT_SETTINGS, HISTORY_MAX, loadHistory, loadSettings, removeFromHistory, saveSettings, saveToHistory,
} from './storage.js'

describe('i18n', () => {
  it('translates, falls back to English, then to the key', () => {
    expect(t('hi', 'help')).toBe('मदद')
    expect(t('xx', 'help')).toBe('Help')
    expect(t('te', 'no-such-key')).toBe('no-such-key')
  })

  it('fills {placeholders}', () => {
    expect(t('en', 'nTactics', { n: 3 })).toBe('3 tactics')
    expect(t('te', 'readyHint', { x: 'GO' })).toContain('“GO”')
  })

  it('has every English string in Hindi and Telugu', () => {
    const en = Object.keys(STRINGS.en)
    for (const { code } of LANGS) {
      const missing = en.filter((k) => !STRINGS[code][k])
      expect(missing, `missing in ${code}`).toEqual([])
    }
  })
})

describe('format', () => {
  it('formats the call clock', () => {
    expect(fmtClock(0)).toBe('00:00')
    expect(fmtClock(75.9)).toBe('01:15')
  })

  it('builds the family WhatsApp link like the backend', () => {
    expect(familyWhatsApp('', 'A')).toBe('')
    expect(familyWhatsApp('98765 43210', 'Lakshmi')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=Lakshmi%20may%20be/)
    expect(familyWhatsApp('+44 7700 900123')).toMatch(/^https:\/\/wa\.me\/447700900123\?text=I%20may/)
  })

  it('picks the caller status pill', () => {
    expect(callStatus(0, false)).toEqual(['waiting', 'idle'])
    expect(callStatus(0, true)).toEqual(['monitoring', 'good'])
    expect(callStatus(1, true)).toEqual(['caution', 'warn'])
    expect(callStatus(3, true)).toEqual(['suspected', 'bad'])
  })

  it('renders the hard rule with localized labels', () => {
    expect(hardRuleText('AUTHORITY then MONEY_ASK', { AUTHORITY: 'అధికారి', MONEY_ASK: 'డబ్బు' })).toBe('అధికారి → డబ్బు')
    expect(hardRuleText('AUTHORITY then REMOTE_ACCESS')).toBe('authority → remote access')
    expect(hardRuleText('')).toBe('')
  })
})

describe('route', () => {
  it('parses hashes and defaults to the live screen', () => {
    expect(parseHash('')).toEqual({ screen: 'live', id: '' })
    expect(parseHash('#/history')).toEqual({ screen: 'history', id: '' })
    expect(parseHash('#/report/abc%2F1')).toEqual({ screen: 'report', id: 'abc/1' })
    expect(parseHash('#/nonsense')).toEqual({ screen: 'live', id: '' })
  })

  it('builds hashes that parse back', () => {
    expect(hashFor('live')).toBe('#/')
    expect(hashFor('report', 'abc/1')).toBe('#/report/abc%2F1')
    expect(parseHash(hashFor('report', 'abc/1'))).toEqual({ screen: 'report', id: 'abc/1' })
  })
})

describe('storage', () => {
  const report = (id, extra = {}) => ({ call_id: id, started_at: '2026-10-08T10:00:00', peak_score: 50, ...extra })

  it('merges saved settings over the defaults and survives junk', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    saveSettings({ lang: 'te' })
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, lang: 'te' })
    localStorage.setItem('jam-settings', '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps history newest first, one entry per call, capped', () => {
    saveToHistory(report('a'))
    saveToHistory(report('b'))
    saveToHistory(report('a', { peak_score: 90 }))
    const h = loadHistory()
    expect(h.map((x) => x.call_id)).toEqual(['a', 'b'])
    expect(h[0].peak_score).toBe(90)
    for (let i = 0; i < HISTORY_MAX + 5; i++) saveToHistory(report(`r${i}`))
    expect(loadHistory()).toHaveLength(HISTORY_MAX)
  })

  it('removes one incident and persists it', () => {
    saveToHistory(report('a'))
    saveToHistory(report('b'))
    removeFromHistory(loadHistory(), 'a')
    expect(loadHistory().map((x) => x.call_id)).toEqual(['b'])
  })

  it('treats non-array history as empty', () => {
    localStorage.setItem('jam-history', '{"x":1}')
    expect(loadHistory()).toEqual([])
  })
})

describe('theme', () => {
  it('forces light or dark through data-theme and clears it for system', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    applyTheme(undefined)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('defaults the saved setting to system', () => {
    expect(loadSettings().theme).toBe('system')
  })
})
