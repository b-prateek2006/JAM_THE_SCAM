// Settings and incident reports, kept in this browser's localStorage only.
// Every access is guarded: storage can be missing or full (private mode, quota).

const SETTINGS_KEY = 'jam-settings'
export const HISTORY_KEY = 'jam-history'
export const HISTORY_MAX = 20

export const DEFAULT_SETTINGS = {
  lang: 'en', user_name: '', family_phone: '', caller_number: '', source: 'demo',
  scenario: 'inspector_sharma', use_l3: true, voice_demo: false, theme: 'system',
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
  return value
}

export function loadSettings() {
  const saved = read(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings)
}

// Incident reports live on this device only; the server doesn't keep a shared list.
export function loadHistory() {
  const h = read(HISTORY_KEY)
  return Array.isArray(h) ? h : []
}

export function writeHistory(history) {
  return write(HISTORY_KEY, history)
}

// Newest first, one entry per call, capped at HISTORY_MAX.
export function saveToHistory(report) {
  const entry = { call_id: report.call_id, started_at: report.started_at, peak_score: report.peak_score, report }
  return writeHistory([entry, ...loadHistory().filter((h) => h.call_id !== report.call_id)].slice(0, HISTORY_MAX))
}

export function removeFromHistory(history, callId) {
  return writeHistory(history.filter((h) => h.call_id !== callId))
}
