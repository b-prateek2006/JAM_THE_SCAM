import { useEffect, useRef, useState } from 'react'
import { api, GuardSocket } from '../api.js'
import { startAudioStream } from '../audio/micCapture.js'
import { startBrowserStt } from '../audio/browserStt.js'
import { t } from '../lib/i18n.js'
import { speak, stopSpeaking } from '../lib/tts.js'

export const EMPTY = { score: 0, level: 0, level_name: 'SAFE', stage: 0, tactics: [], hard_rule: '' }
// Browser speech-recognition errors that won't recover by restarting.
const FATAL_STT = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']
// If the server never answers "stop" with a report, give up after this long.
export const REPORT_TIMEOUT_MS = 15000

// One guarded call: opens the WebSocket, feeds it from the chosen source (demo scenario, mic,
// audio file or browser speech-to-text), tracks score / transcript / alerts, and ends with a
// report (end) or without one (abort: failed start, dropped connection, fatal input error).
export function useGuardCall({ settings, file, micReady, onReport }) {
  const [active, setActive] = useState(false)
  const [state, setState] = useState(EMPTY)
  const [lines, setLines] = useState([])
  const [interim, setInterim] = useState('')
  const [alert, setAlert] = useState(null)
  const [overlay, setOverlay] = useState(false)
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [connecting, setConnecting] = useState(false)
  // Why the server can't hear an audio call ('no_audio' | 'no_speech' | 'muted'), and the mic in use.
  const [hint, setHint] = useState('')
  const [device, setDevice] = useState('')
  const sock = useRef(null)
  const stopper = useRef(null)
  const demoTimer = useRef(null)
  const reportTimer = useRef(null)
  const starting = useRef(false) // set synchronously, so a double tap can't open two sockets
  const lang = settings.lang

  useEffect(() => {
    if (!active) return
    const t0 = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500)
    return () => clearInterval(id)
  }, [active])

  function onMessage(msg) {
    if (msg.type === 'update') {
      setState(msg)
      if (msg.utterance) setLines((l) => [...l, msg.utterance])
      if (msg.alert) {
        setAlert(msg.alert)
        if (msg.alert.level >= 2) {
          setOverlay(true)
          navigator.vibrate?.(msg.alert.level >= 3 ? [400, 150, 400, 150, 400] : [300, 100, 300])
        }
        if (msg.alert.spoken) speak(msg.alert.spoken, lang)
      }
    } else if (msg.type === 'report') {
      // The server can end the call itself (time limit), so stop listening here too.
      stopInput()
      setOverlay(false)
      setHint('')
      clearTimeout(reportTimer.current)
      if (sock.current) sock.current.done = true
      setActive(false)
      sock.current?.close()
      onReport(msg.report)
    } else if (msg.type === 'stt') {
      if (msg.text) setHint('') // it can hear the call after all
    } else if (msg.type === 'hint') {
      setHint(msg.code)
    } else if (msg.type === 'error') {
      setError(msg.message)
    }
  }

  function stopInput() {
    stopper.current?.stop()
    stopper.current = null
    clearTimeout(demoTimer.current)
    stopSpeaking()
  }

  // Ends a call that can't continue (start failed, connection lost) without waiting for a report.
  function abort(message) {
    stopInput()
    clearTimeout(reportTimer.current)
    setOverlay(false)
    setActive(false)
    setInterim('')
    setHint('')
    const s = sock.current
    if (s) {
      s.done = true
      s.close()
    }
    if (message) setError((e) => e || message)
  }

  // Resolves true once the call is live, false if it could not start (or one is already starting / live).
  async function start() {
    if (starting.current || active) return false
    starting.current = true
    setConnecting(true)
    try {
      return await connect()
    } finally {
      starting.current = false
      setConnecting(false)
    }
  }

  async function connect() {
    const fail = (key) => {
      setError(t(lang, key))
      return false
    }
    setError('')
    if (settings.source === 'file' && !file) return fail('chooseFile')
    if (settings.source === 'mic' && !micReady) return fail('sttUnavailable')
    let sc = null
    if (settings.source === 'demo') {
      try {
        sc = await api.scenario(settings.scenario)
      } catch {
        return fail('serverDown')
      }
    }
    reset()
    const s = new GuardSocket({
      onMessage,
      // A drop after the call started (server restart, time limit, network loss) ends protection visibly.
      onClose: () => {
        if (sock.current === s && s.started && !s.done) abort(t(lang, 'connLost'))
      },
    })
    sock.current = s
    try {
      await s.ready
    } catch {
      return fail('serverDown')
    }
    s.started = true
    s.start({
      lang, source: settings.source, user_name: settings.user_name, family_phone: settings.family_phone,
      caller_number: settings.caller_number, use_l3: settings.use_l3,
    })
    setActive(true)
    try {
      if (settings.source === 'mic' || settings.source === 'file') {
        stopper.current = await startAudioStream({
          file: settings.source === 'file' ? file : null,
          onChunk: (pcm) => s.sendAudio(pcm),
          onLevel: setLevel,
          // Tracked like the demo timer, so ending or restarting the call cancels it.
          onEnded: () => { demoTimer.current = setTimeout(end, 2500) },
          onMuted: (muted) => setHint((h) => (muted ? 'muted' : h === 'muted' ? '' : h)),
        })
        setDevice(stopper.current.label || '')
      } else if (settings.source === 'browser') {
        stopper.current = startBrowserStt({
          lang,
          onFinal: (text) => { setInterim(''); s.text(text, 'unknown') },
          onInterim: setInterim,
          onError: (e) => {
            const msg = `${t(lang, 'speechError')}: ${e}`
            if (FATAL_STT.includes(e)) abort(msg)
            else setError(msg)
          },
        })
      } else {
        playScenario(s, sc)
      }
    } catch (e) {
      abort(e.message || String(e))
      return false
    }
    return true
  }

  function playScenario(s, sc) {
    let i = 0
    const next = () => {
      if (i >= sc.lines.length) {
        demoTimer.current = setTimeout(end, 4000)
        return
      }
      const line = sc.lines[i++]
      demoTimer.current = setTimeout(() => {
        s.text(line.text, line.speaker)
        if (settings.voice_demo && line.speaker === 'caller') speak(line.text, sc.lang, { rate: 1.05 })
        next()
      }, (i === 1 ? 600 : line.delay * 1000))
    }
    next()
    stopper.current = { stop: () => clearTimeout(demoTimer.current) }
  }

  // Asks the server for the report; gives up if it never arrives.
  function end() {
    stopInput()
    setOverlay(false)
    setHint('')
    const s = sock.current
    if (!s || s.done) return
    s.stop(true)
    clearTimeout(reportTimer.current)
    reportTimer.current = setTimeout(() => {
      if (sock.current === s && !s.done) abort(t(lang, 'connLost'))
    }, REPORT_TIMEOUT_MS)
  }

  function reset() {
    setState(EMPTY)
    setLines([])
    setAlert(null)
    setOverlay(false)
    setInterim('')
    setHint('')
    setDevice('')
  }

  return {
    active, connecting, state, lines, interim, alert, overlay, error, level, elapsed, hint, device,
    start, end, reset, setError, dismissOverlay: () => setOverlay(false),
  }
}
