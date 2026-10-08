// Spoken warnings via the browser's speechSynthesis, in the user's language.
const LOCALES = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }

function pickVoice(locale) {
  const voices = window.speechSynthesis?.getVoices() || []
  return (
    voices.find((v) => v.lang === locale) ||
    voices.find((v) => v.lang?.startsWith(locale.split('-')[0])) ||
    null
  )
}

export function speak(text, lang = 'en', { rate = 0.95 } = {}) {
  if (!window.speechSynthesis || !text) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const locale = LOCALES[lang] || 'en-IN'
  u.lang = locale
  const v = pickVoice(locale)
  if (v) u.voice = v
  u.rate = rate
  u.volume = 1
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel()
}

// Voices load asynchronously in Chrome.
window.speechSynthesis?.addEventListener?.('voiceschanged', () => {})
