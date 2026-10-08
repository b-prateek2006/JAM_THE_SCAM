// Small pure helpers for the live-call screen.

export const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// Same normalisation as the backend's whatsapp_link: bare 10-digit numbers are Indian.
export function familyWhatsApp(phone, name) {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const to = digits.length === 10 ? `91${digits}` : digits
  const who = name || 'I'
  const msg = `${who} may be on a scam call right now (someone claiming to be police/CBI). Please call immediately.`
  return `https://wa.me/${to}?text=${encodeURIComponent(msg)}`
}

// [i18n key, pill class] for the caller status pill.
export function callStatus(level, active) {
  if (level >= 2) return ['suspected', 'bad']
  if (level === 1) return ['caution', 'warn']
  return active ? ['monitoring', 'good'] : ['waiting', 'idle']
}

// The backend's hard rule reads like "AUTHORITY then MONEY_ASK"; show it with localized tactic labels.
export function hardRuleText(rule, labels = {}) {
  return (rule || '').replace(' then ', ' → ').replace(/[A-Z_]{4,}/g, (k) => labels[k] || k.replace(/_/g, ' ').toLowerCase())
}
