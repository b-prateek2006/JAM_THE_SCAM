// Web Speech API fallback: the browser does speech-to-text (Chrome supports
// te-IN, hi-IN and en-IN) and we send the text. Used when server STT is busy,
// or for Telugu where browser recognition can beat Whisper small.
const LOCALES = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

export function browserSttSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function startBrowserStt({ lang, onFinal, onInterim, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) throw new Error('Speech recognition is not supported in this browser. Use Chrome.')
  let stopped = false
  const rec = new SR()
  rec.lang = LOCALES[lang] || 'en-IN'
  rec.continuous = true
  rec.interimResults = true
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) onFinal(r[0].transcript.trim())
      else interim += r[0].transcript
    }
    onInterim?.(interim)
  }
  rec.onerror = (e) => {
    if (FATAL.has(e.error)) stopped = true // restarting would just fail again in a loop
    if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(e.error)
  }
  rec.onend = () => {
    if (stopped) return
    try {
      rec.start() // Chrome ends sessions after silence; keep listening
    } catch (err) {
      onError?.(err.message || String(err))
    }
  }
  rec.start()
  return {
    stop() {
      stopped = true
      rec.stop()
    },
  }
}
