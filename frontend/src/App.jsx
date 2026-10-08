import { useEffect, useRef, useState } from 'react'
import { api, GuardSocket } from './api.js'
import { startAudioStream } from './audio/micCapture.js'
import { browserSttSupported, startBrowserStt } from './audio/browserStt.js'
import AlertBanner from './components/AlertBanner.jsx'
import ReportView from './components/ReportView.jsx'
import RiskMeter from './components/RiskMeter.jsx'
import StageTrack from './components/StageTrack.jsx'
import TacticChips from './components/TacticChips.jsx'
import Transcript from './components/Transcript.jsx'
import { LANGS, t } from './lib/i18n.js'
import { speak, stopSpeaking } from './lib/tts.js'

const EMPTY = { score: 0, level: 0, level_name: 'SAFE', stage: 0, tactics: [], hard_rule: '' }
const LEVEL_KEY = ['safe', 'caution', 'warning', 'critical']

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('jam-settings')) || {}
  } catch {
    return {}
  }
}

export default function App() {
  const [settings, setSettings] = useState(() => ({
    lang: 'en', user_name: '', family_phone: '', caller_number: '', source: 'demo',
    scenario: 'inspector_sharma', use_l3: true, voice_demo: false, ...loadSettings(),
  }))
  const [screen, setScreen] = useState('home')
  const [health, setHealth] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [history, setHistory] = useState([])
  const [state, setState] = useState(EMPTY)
  const [lines, setLines] = useState([])
  const [interim, setInterim] = useState('')
  const [alert, setAlert] = useState(null)
  const [overlay, setOverlay] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)
  const [file, setFile] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const sock = useRef(null)
  const stopper = useRef(null)
  const demoTimer = useRef(null)
  const lang = settings.lang

  useEffect(() => {
    try {
      localStorage.setItem('jam-settings', JSON.stringify(settings))
    } catch {}
  }, [settings])

  const refresh = () => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.scenarios().then(setScenarios).catch(() => {})
    api.incidents().then(setHistory).catch(() => {})
  }
  useEffect(refresh, [])

  useEffect(() => {
    if (screen !== 'guard') return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500)
    return () => clearInterval(id)
  }, [screen])

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

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
      setReport(msg.report)
      setScreen('report')
      sock.current?.close()
      refresh()
    } else if (msg.type === 'error') {
      setError(msg.message)
    }
  }

  async function startGuard() {
    setError('')
    setState(EMPTY)
    setLines([])
    setAlert(null)
    setOverlay(false)
    setReport(null)
    setInterim('')
    const s = new GuardSocket({ onMessage })
    sock.current = s
    try {
      await s.ready
    } catch {
      setError('Cannot reach the Jam the Scam server. Is the backend running?')
      return
    }
    s.start({
      lang, user_name: settings.user_name, family_phone: settings.family_phone,
      caller_number: settings.caller_number, use_l3: settings.use_l3,
    })
    setScreen('guard')
    try {
      if (settings.source === 'mic' || settings.source === 'file') {
        if (settings.source === 'file' && !file) throw new Error('Choose an audio file first.')
        stopper.current = await startAudioStream({
          file: settings.source === 'file' ? file : null,
          onChunk: (pcm) => s.sendAudio(pcm),
          onLevel: setLevel,
          onEnded: () => setTimeout(endCall, 2500),
        })
      } else if (settings.source === 'browser') {
        stopper.current = startBrowserStt({
          lang,
          onFinal: (text) => { setInterim(''); s.text(text, 'unknown') },
          onInterim: setInterim,
          onError: (e) => setError(`Speech recognition: ${e}`),
        })
      } else {
        await playScenario(s)
      }
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  async function playScenario(s) {
    const sc = await api.scenario(settings.scenario)
    let i = 0
    const next = () => {
      if (i >= sc.lines.length) {
        demoTimer.current = setTimeout(endCall, 4000)
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

  function endCall() {
    stopper.current?.stop()
    stopper.current = null
    clearTimeout(demoTimer.current)
    stopSpeaking()
    setOverlay(false)
    sock.current?.stop(true)
  }

  const levelLabel = t(lang, LEVEL_KEY[state.level] || 'safe')
  const mm = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`

  return (
    <div className={`app level-${state.level}`}>
      <header className="top">
        <div className="brand"><img src="/icons/icon.svg" alt="" /> Jam the Scam</div>
        <div className="langs">
          {LANGS.map((l) => (
            <button key={l.code} className={l.code === lang ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, lang: l.code }))}>{l.label}</button>
          ))}
        </div>
      </header>

      {error && <div className="banner error" onClick={() => setError('')}>{error}</div>}

      {screen === 'home' && (
        <main className="home">
          <p className="tagline">{t(lang, 'tagline')}</p>

          <section className="card">
            <label className="field">{t(lang, 'source')}
              <select value={settings.source} onChange={set('source')}>
                <option value="demo">{t(lang, 'demo')}</option>
                <option value="mic">{t(lang, 'mic')}</option>
                <option value="browser" disabled={!browserSttSupported()}>{t(lang, 'browser')}</option>
                <option value="file">{t(lang, 'file')}</option>
              </select>
            </label>
            {settings.source === 'demo' && (
              <>
                <label className="field">Scenario
                  <select value={settings.scenario} onChange={set('scenario')}>
                    {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={settings.voice_demo} onChange={set('voice_demo')} /> Read caller lines aloud</label>
              </>
            )}
            {settings.source === 'file' && (
              <label className="field">Audio file
                <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0] || null)} />
              </label>
            )}
            {settings.source === 'mic' && health && !health.stt?.ready && (
              <p className="muted small">Server speech-to-text is {health.stt?.error ? 'unavailable' : 'still loading'}. Browser speech-to-text works meanwhile.</p>
            )}
          </section>

          <button className="btn primary huge" onClick={startGuard}>🛡️ {t(lang, 'guard')}</button>

          <details className="card">
            <summary>{t(lang, 'settings')}</summary>
            <label className="field">{t(lang, 'yourName')}<input value={settings.user_name} onChange={set('user_name')} placeholder="Lakshmi" /></label>
            <label className="field">{t(lang, 'family')}<input value={settings.family_phone} onChange={set('family_phone')} placeholder="98xxxxxxxx" inputMode="tel" /></label>
            <label className="field">{t(lang, 'caller')}<input value={settings.caller_number} onChange={set('caller_number')} placeholder="+91…" inputMode="tel" /></label>
            <label className="check"><input type="checkbox" checked={settings.use_l3} onChange={set('use_l3')} /> Use LLM reasoner (L3) when configured</label>
          </details>

          {health && (
            <p className="status muted small">
              Engine: L1 lexicon · L2 {health.l2} · L3 {health.l3 ? `${health.l3.provider}` : 'off'} · STT {health.stt?.ready ? health.stt.name : 'browser'}
            </p>
          )}

          {history.length > 0 && (
            <section className="card">
              <h3>{t(lang, 'history')}</h3>
              <ul className="history">
                {history.slice(0, 5).map((h) => (
                  <li key={h.call_id} onClick={() => api.incident(h.call_id).then((r) => { setReport(r); setScreen('report') })}>
                    <span>{new Date(h.started_at).toLocaleString()}</span>
                    <b style={{ color: h.peak_score >= 85 ? 'var(--crit)' : h.peak_score >= 40 ? 'var(--caution)' : 'var(--ok)' }}>{h.peak_score}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="muted small center">{t(lang, 'privacy')}</p>
        </main>
      )}

      {screen === 'guard' && (
        <main className="guard">
          <div className="live"><span className="rec" /> LIVE CALL · {mm}
            {(settings.source === 'mic' || settings.source === 'file') && <span className="vu" style={{ width: `${Math.min(100, level * 400)}%` }} />}
          </div>
          {alert && alert.level === 1 && <AlertBanner alert={alert} lang={lang} />}
          <RiskMeter score={state.score} label={levelLabel}
            sub={state.hard_rule ? `Hard rule: ${state.hard_rule.replace(/_/g, ' ').toLowerCase()}` : state.explanation || ''} />
          <section className="card">
            <h3>{t(lang, 'stage')}</h3>
            <StageTrack tactics={state.tactics} />
          </section>
          <section className="card">
            <h3>{t(lang, 'tactics')}</h3>
            <TacticChips tactics={state.tactics} emptyText={t(lang, 'noTactics')} />
          </section>
          <section className="card grow">
            <h3>{t(lang, 'transcript')}</h3>
            {lines.length === 0 && !interim && <p className="muted small">{t(lang, 'listening')}</p>}
            <Transcript lines={lines} interim={interim} />
          </section>
          <button className="btn danger big sticky" onClick={endCall}>{t(lang, 'endCall')}</button>
          {overlay && <AlertBanner alert={alert} lang={lang} onDismiss={() => setOverlay(false)} onHangUp={endCall} />}
        </main>
      )}

      {screen === 'report' && report && (
        <main>
          <ReportView report={report} lang={lang} onNew={() => { setScreen('home'); setState(EMPTY) }} />
        </main>
      )}
    </div>
  )
}
