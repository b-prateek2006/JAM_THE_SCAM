import { useEffect, useRef, useState } from 'react'
import { api, GuardSocket } from './api.js'
import { startAudioStream } from './audio/micCapture.js'
import { browserSttSupported, startBrowserStt } from './audio/browserStt.js'
import AlertBanner from './components/AlertBanner.jsx'
import HeroPhone, { ScammerAvatar } from './components/HeroPhone.jsx'
import Icon from './components/Icon.jsx'
import ReportView from './components/ReportView.jsx'
import RiskMeter, { riskColor } from './components/RiskMeter.jsx'
import StageTrack from './components/StageTrack.jsx'
import Transcript from './components/Transcript.jsx'
import { callStatus, familyWhatsApp, fmtClock, hardRuleText } from './lib/format.js'
import { LANGS, t } from './lib/i18n.js'
import { loadHistory, loadSettings, removeFromHistory, saveSettings, saveToHistory, writeHistory } from './lib/storage.js'
import { useHashRoute } from './lib/route.js'
import { speak, stopSpeaking } from './lib/tts.js'

const EMPTY = { score: 0, level: 0, level_name: 'SAFE', stage: 0, tactics: [], hard_rule: '' }
const LEVEL_KEY = ['safe', 'caution', 'warning', 'critical']
// Browser speech-recognition errors that won't recover by restarting.
const FATAL_STT = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']
// If the server never answers "stop" with a report, give up after this long.
const REPORT_TIMEOUT_MS = 15000

const NAV = [
  { id: 'live', icon: 'phone', key: 'liveCall' },
  { id: 'history', icon: 'clock', key: 'history' },
  { id: 'settings', icon: 'settings', key: 'settings' },
  { id: 'help', icon: 'help', key: 'help' },
]

const STEPS = [
  { icon: 'mic', n: 1, tone: 'violet' },
  { icon: 'waves', n: 2, tone: 'teal' },
  { icon: 'brain', n: 3, tone: 'indigo' },
  { icon: 'shield', n: 4, tone: 'pink' },
]

const WHY = [
  { icon: 'mic', key: 'why1' },
  { icon: 'brain', key: 'why2' },
  { icon: 'shield', key: 'why3' },
]

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [route, go] = useHashRoute()
  const [active, setActive] = useState(false)
  const [health, setHealth] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [history, setHistory] = useState(loadHistory)
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
  const reportTimer = useRef(null)
  const lang = settings.lang
  const screen = route.screen

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const refresh = () => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api.scenarios().then(setScenarios).catch(() => {})
  }
  useEffect(refresh, [])

  useEffect(() => {
    if (!active) return
    const t0 = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500)
    return () => clearInterval(id)
  }, [active])

  // A report link that no longer exists (deleted, or another device's) falls back to the list.
  const shownReport = screen === 'report'
    ? history.find((h) => h.call_id === route.id)?.report || (report?.call_id === route.id ? report : null)
    : null
  useEffect(() => {
    if (screen === 'report' && !shownReport) location.replace('#/history')
  }, [screen, shownReport])

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setLang = (code) => setSettings((s) => ({ ...s, lang: code }))

  // Server STT is only usable when /api/health says it loaded. Unknown health (still fetching) is allowed.
  const micReady = !health || !!health.stt?.ready

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
      clearTimeout(reportTimer.current)
      if (sock.current) sock.current.done = true
      setReport(msg.report)
      setHistory(saveToHistory(msg.report))
      setActive(false)
      go('report', msg.report.call_id)
      sock.current?.close()
      refresh()
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
  function abortCall(message) {
    stopInput()
    clearTimeout(reportTimer.current)
    setOverlay(false)
    setActive(false)
    setInterim('')
    const s = sock.current
    if (s) {
      s.done = true
      s.close()
    }
    if (message) setError((e) => e || message)
  }

  async function startGuard() {
    setError('')
    if (settings.source === 'file' && !file) return setError(t(lang, 'chooseFile'))
    if (settings.source === 'mic' && !micReady) return setError(t(lang, 'sttUnavailable'))
    let sc = null
    if (settings.source === 'demo') {
      try {
        sc = await api.scenario(settings.scenario)
      } catch {
        return setError(t(lang, 'serverDown'))
      }
    }
    setState(EMPTY)
    setLines([])
    setAlert(null)
    setOverlay(false)
    setInterim('')
    const s = new GuardSocket({
      onMessage,
      // A drop after the call started (server restart, time limit, network loss) ends protection visibly.
      onClose: () => {
        if (sock.current === s && s.started && !s.done) abortCall(t(lang, 'connLost'))
      },
    })
    sock.current = s
    try {
      await s.ready
    } catch {
      return setError(t(lang, 'serverDown'))
    }
    s.started = true
    s.start({
      lang, user_name: settings.user_name, family_phone: settings.family_phone,
      caller_number: settings.caller_number, use_l3: settings.use_l3,
    })
    setActive(true)
    go('live')
    try {
      if (settings.source === 'mic' || settings.source === 'file') {
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
          onError: (e) => {
            const msg = `${t(lang, 'speechError')}: ${e}`
            if (FATAL_STT.includes(e)) abortCall(msg)
            else setError(msg)
          },
        })
      } else {
        playScenario(s, sc)
      }
    } catch (e) {
      abortCall(e.message || String(e))
    }
  }

  function playScenario(s, sc) {
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
    stopInput()
    setOverlay(false)
    const s = sock.current
    if (!s || s.done) return
    s.stop(true)
    clearTimeout(reportTimer.current)
    reportTimer.current = setTimeout(() => {
      if (sock.current === s && !s.done) abortCall(t(lang, 'connLost'))
    }, REPORT_TIMEOUT_MS)
  }

  function prepareComplaint() {
    if (active) return endCall()
    const r = report || history[0]?.report
    if (!r) return window.open('https://cybercrime.gov.in', '_blank', 'noopener')
    go('report', r.call_id, { scroll: false })
    setTimeout(() => document.getElementById('complaint')?.scrollIntoView({ behavior: 'smooth' }), 80)
  }

  function deleteIncident(id) {
    setHistory((h) => removeFromHistory(h, id))
    if (report?.call_id === id) setReport(null)
  }

  function clearHistory() {
    if (!window.confirm(t(lang, 'confirmClear'))) return
    setHistory(writeHistory([]))
    setReport(null)
  }

  const lvl = state.level
  const levelLabel = active || state.score > 0 ? t(lang, LEVEL_KEY[lvl] || 'safe') : ''
  const waLink = alert?.family?.whatsapp_link || familyWhatsApp(settings.family_phone, settings.user_name)
  const online = !!health?.ok
  const status = callStatus(lvl, active)
  const showRail = screen === 'live' || screen === 'report'
  const tacticLabels = Object.fromEntries(state.tactics.map((x) => [x.type, x.label]))
  const hardRule = hardRuleText(state.hard_rule, tacticLabels)
  const langSwitch = (cls = '') => (
    <div className={`seg ${cls}`} role="group" aria-label={t(lang, 'language')}>
      {LANGS.map((l) => (
        <button key={l.code} lang={l.code} className={l.code === lang ? 'on' : ''} disabled={active}
          aria-pressed={l.code === lang} onClick={() => setLang(l.code)}>{l.label}</button>
      ))}
    </div>
  )

  // ---------------------------------------------------------------- screens
  const hero = (
    <section className={`hero ${active ? 'is-active' : ''}`}>
      <div className="hero-copy">
        <span className="eyebrow light">{t(lang, 'heroEyebrow')}</span>
        <h1>{t(lang, 'heroTitle')}</h1>
        <p>{t(lang, 'heroBody')}</p>
        {active ? (
          <button className="btn hero-btn stop" onClick={endCall}><Icon name="phoneOff" size={18} /> {t(lang, 'endCall')}</button>
        ) : (
          <>
            <div className="hero-setup">
              <label>
                <span>{t(lang, 'source')}</span>
                <select value={settings.source} onChange={set('source')}>
                  <option value="demo">{t(lang, 'demo')}</option>
                  <option value="mic" disabled={!micReady}>{t(lang, 'mic')}</option>
                  <option value="browser" disabled={!browserSttSupported()}>{t(lang, 'browser')}</option>
                  <option value="file">{t(lang, 'file')}</option>
                </select>
              </label>
              {settings.source === 'demo' && (
                <label>
                  <span>{t(lang, 'scenario')}</span>
                  <select value={settings.scenario} onChange={set('scenario')}>
                    {scenarios.length === 0 && <option value={settings.scenario}>{settings.scenario}</option>}
                    {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>
              )}
              {settings.source === 'file' && (
                <label>
                  <span>{t(lang, 'audioFile')}</span>
                  <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0] || null)} />
                </label>
              )}
            </div>
            {settings.source === 'mic' && !micReady && <p className="hero-note">{t(lang, 'sttUnavailable')}</p>}
            <button className="btn hero-btn" onClick={startGuard}>
              <Icon name="shieldCheck" size={18} /> {t(lang, 'guard')} <Icon name="arrowRight" size={18} />
            </button>
          </>
        )}
      </div>
      <HeroPhone tactics={state.tactics} number={settings.caller_number} lang={lang} />
    </section>
  )

  const alertBox = (() => {
    if (lvl >= 3) {
      return (
        <div className="callout crit">
          <span className="callout-icon"><Icon name="alert" size={22} /></span>
          <div>
            <span className="eyebrow">{t(lang, 'highRisk')}</span>
            <strong>{t(lang, 'hangUpShout')}</strong>
            <p>{alert?.message || t(lang, 'critFallback')}</p>
          </div>
        </div>
      )
    }
    if (lvl >= 1) {
      return (
        <div className={`callout ${lvl === 2 ? 'warn' : 'caution'}`}>
          <span className="callout-icon"><Icon name="triangle" size={20} /></span>
          <div>
            <span className="eyebrow">{t(lang, LEVEL_KEY[lvl])}</span>
            <p>{alert?.message || state.explanation}</p>
          </div>
        </div>
      )
    }
    return (
      <div className={`callout ${active ? 'ok' : 'idle'}`}>
        <span className="callout-icon"><Icon name={active ? 'checkCircle' : 'shield'} size={20} /></span>
        <div>
          <span className="eyebrow">{active ? t(lang, 'listening') : t(lang, 'ready')}</span>
          <p>{active ? t(lang, 'noTactics') : t(lang, 'readyHint', { x: t(lang, 'guard') })}</p>
        </div>
      </div>
    )
  })()

  const livePanel = (
    <section className={`card live-panel level-${lvl}`}>
      {/* Screen readers hear each change of alert level once, not every score tick. */}
      <div className="sr-only" aria-live="assertive">{active && lvl > 0 ? `${levelLabel}. ${alert?.message || ''}` : ''}</div>
      <div className="live-left">
        <div className="live-head">
          <span className={`live-tag ${active ? 'on' : ''}`}><span className="rec" /> {t(lang, active ? 'liveTag' : 'noCall')}</span>
          <span className="live-time">
            {fmtClock(elapsed)}
            <span className={`wave ${active ? 'on' : ''}`} style={{ '--vu': Math.min(1, 0.35 + level * 6) }} aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </span>
        </div>
        <div className="caller">
          <ScammerAvatar size={56} />
          <div>
            <b>{t(lang, 'unknownCaller')}</b>
            <span className="caller-num">{settings.caller_number || t(lang, 'unknownNumber')}</span>
            <span className={`status-pill ${status[1]}`}>{t(lang, status[0])}</span>
          </div>
        </div>
        <RiskMeter score={state.score} label={levelLabel} caption={t(lang, 'riskScore')} />
        {state.hard_rule && <p className="hard-rule">{t(lang, 'hardRule')}: {hardRule}</p>}
        {alertBox}
      </div>
      <div className="live-right">
        <h3 className="card-title">{t(lang, 'stages')}</h3>
        <StageTrack tactics={state.tactics} lang={lang} />
        <div className="transcript-head">
          <h3 className="card-title">{t(lang, 'transcript')} {active && <span className="live-dot">{t(lang, 'liveDot')}</span>}</h3>
          {langSwitch('small')}
        </div>
        <Transcript lines={lines} interim={interim} lang={lang} labels={tacticLabels} emptyText={active ? t(lang, 'listening') : t(lang, 'idle')} />
        <div className={`listening ${active ? 'on' : ''}`}>
          <Icon name="waves" size={16} /> {t(lang, active ? 'listeningCall' : 'micOff')}
        </div>
      </div>
    </section>
  )

  const howItWorks = (
    <section className="how">
      <div className="how-intro">
        <h2>{t(lang, 'howItWorks')}</h2>
        <p className="muted">{t(lang, 'howSub')}</p>
      </div>
      <div className="steps">
        {STEPS.map((s) => (
          <div key={s.n} className="step">
            <span className={`step-icon ${s.tone}`}><Icon name={s.icon} size={24} /></span>
            <b>{s.n}. {t(lang, `step${s.n}t`)}</b>
            <p>{t(lang, `step${s.n}b`)}</p>
          </div>
        ))}
      </div>
    </section>
  )

  const rail = (
    <aside className="rail">
      <section className="card">
        <h3 className="card-title lg">{t(lang, 'quickActions')}</h3>
        <div className="actions">
          <button className="action hang" onClick={endCall} disabled={!active}>
            <span className="action-icon"><Icon name="phoneOff" size={22} /></span>
            <span><b>{t(lang, 'hangUpNow')}</b><small>{t(lang, active ? 'hangUpSubActive' : 'hangUpSubIdle')}</small></span>
          </button>
          {waLink ? (
            <a className="action family" href={waLink} target="_blank" rel="noreferrer">
              <span className="action-icon"><Icon name="users" size={22} /></span>
              <span><b>{t(lang, 'alertFamily')}</b><small>{t(lang, 'sendWhatsApp')}</small></span>
            </a>
          ) : (
            <button className="action family" onClick={() => go('settings')}>
              <span className="action-icon"><Icon name="users" size={22} /></span>
              <span><b>{t(lang, 'alertFamily')}</b><small>{t(lang, 'needContact')}</small></span>
            </button>
          )}
          <button className="action complaint" onClick={prepareComplaint}>
            <span className="action-icon"><Icon name="file" size={22} /></span>
            <span><b>{t(lang, 'prepareComplaint')}</b><small>1930 / cybercrime.gov.in</small></span>
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title lg"><Icon name="user" size={18} /> {t(lang, 'callerDetails')}</h3>
        <dl className="details">
          <div><dt>{t(lang, 'number')}</dt><dd className="mono">{settings.caller_number || t(lang, 'unknown')}</dd></div>
          <div><dt>{t(lang, 'status')}</dt><dd><span className={`status-pill ${status[1]}`}>{t(lang, status[0])}</span></dd></div>
          <div><dt>{t(lang, 'duration')}</dt><dd className="mono">{fmtClock(elapsed)}</dd></div>
          <div><dt>{t(lang, 'tactics')}</dt><dd>{state.tactics.length}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h3 className="card-title lg">{t(lang, 'whyItWorks')}</h3>
        <ul className="why">
          {WHY.map((w) => (
            <li key={w.key}><span className="why-icon"><Icon name={w.icon} size={20} /></span>{t(lang, w.key)}</li>
          ))}
        </ul>
        <div className="safer">
          <span className="safer-icon"><Icon name="sprout" size={22} /></span>
          <div><b>{t(lang, 'saferTitle')}</b><small>{t(lang, 'saferSub')}</small></div>
        </div>
      </section>
    </aside>
  )

  const historyScreen = (
    <div className="page">
      <div className="page-head spread">
        <div><span className="eyebrow">{t(lang, 'onDevice')}</span><h2>{t(lang, 'history')}</h2></div>
        {history.length > 0 && (
          <button className="btn ghost small danger-text" onClick={clearHistory}><Icon name="x" size={14} /> {t(lang, 'clearAll')}</button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="card empty-state">
          <span className="tile-icon"><Icon name="inbox" size={22} /></span>
          <b>{t(lang, 'noIncidents')}</b>
          <p className="muted">{t(lang, 'noIncidentsBody')}</p>
          <button className="btn primary" onClick={() => go('live')}>{t(lang, 'guard')}</button>
        </div>
      ) : (
        <ul className="incidents">
          {history.map((h) => {
            const c = riskColor(h.peak_score)
            return (
              <li key={h.call_id}>
                <button className="inc-open" onClick={() => go('report', h.call_id)}>
                  <span className="inc-score" style={{ color: c, borderColor: c }}>{h.peak_score}</span>
                  <span className="inc-body">
                    <b>{h.report?.caller_number || t(lang, 'unknownCaller')}</b>
                    <small>{new Date(h.started_at).toLocaleString()} · {h.report?.duration || ''} · {t(lang, 'nTactics', { n: h.report?.tactics?.length || 0 })}</small>
                  </span>
                  <Icon name="chevronRight" />
                </button>
                <button className="inc-delete" onClick={() => deleteIncident(h.call_id)} aria-label={`${t(lang, 'delete')}: ${new Date(h.started_at).toLocaleString()}`}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted small center">{t(lang, 'privacy')}</p>
    </div>
  )

  const settingsScreen = (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">{t(lang, 'savedOnDevice')}</span><h2>{t(lang, 'settings')}</h2></div></div>
      <div className="settings-grid">
        <section className="card">
          <h3 className="card-title">{t(lang, 'youAndFamily')}</h3>
          <label className="field">{t(lang, 'yourName')}<input value={settings.user_name} onChange={set('user_name')} placeholder="Lakshmi" /></label>
          <label className="field">{t(lang, 'family')}<input value={settings.family_phone} onChange={set('family_phone')} placeholder="98xxxxxxxx" inputMode="tel" /></label>
          <label className="field">{t(lang, 'caller')}<input value={settings.caller_number} onChange={set('caller_number')} placeholder="+91…" inputMode="tel" /></label>
        </section>
        <section className="card">
          <h3 className="card-title">{t(lang, 'langDetection')}</h3>
          <div className="field">{t(lang, 'language')}{langSwitch()}</div>
          <label className="check"><input type="checkbox" checked={settings.use_l3} onChange={set('use_l3')} /> {t(lang, 'useL3')}</label>
          <label className="check"><input type="checkbox" checked={settings.voice_demo} onChange={set('voice_demo')} /> {t(lang, 'readAloud')}</label>
          {health && (
            <div className="engine" aria-label={t(lang, 'engine')}>
              <span>L1 lexicon</span>
              <span>L2 {health.l2 || 'off'}</span>
              <span>L3 {health.l3 ? health.l3.provider : 'off'}</span>
              <span>STT {health.stt?.ready ? health.stt.name : 'browser'}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )

  const helpScreen = (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">{t(lang, 'staySafe')}</span><h2>{t(lang, 'help')}</h2></div></div>
      <section className="card">
        <h3 className="card-title">{t(lang, 'neverTitle')}</h3>
        <ul className="never">
          {[1, 2, 3, 4].map((n) => <li key={n}><Icon name="x" size={16} /> {t(lang, `never${n}`)}</li>)}
        </ul>
      </section>
      {howItWorks}
      <section className="card helplines">
        <h3 className="card-title">{t(lang, 'reportScam')}</h3>
        <div className="report-to">
          <a className="btn danger" href="tel:1930"><Icon name="phone" size={16} /> {t(lang, 'call1930')}</a>
          <a className="btn soft" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">cybercrime.gov.in <Icon name="external" size={14} /></a>
          <a className="btn soft" href="https://sancharsaathi.gov.in" target="_blank" rel="noreferrer">Sanchar Saathi Chakshu <Icon name="external" size={14} /></a>
        </div>
      </section>
    </div>
  )

  return (
    <div className={`shell level-${lvl} ${active ? 'calling' : ''} ${showRail ? '' : 'no-rail'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="phone" size={22} /></span>
          <div>
            <b>Jam the Scam</b>
            <small>{t(lang, 'tagline')}</small>
          </div>
        </div>
        <div className="top-right">
          <span className={`protect ${online ? 'on' : ''}`}><span className="dot" /> {online ? t(lang, 'protectionActive') : t(lang, 'offline')}</span>
          {langSwitch('langs')}
          <button className="avatar" onClick={() => go('settings')} aria-label={t(lang, 'settings')}>
            {settings.user_name.trim() ? settings.user_name.trim()[0].toUpperCase() : <Icon name="user" size={18} />}
          </button>
        </div>
      </header>

      <nav className="sidebar" aria-label="Main">
        <div className="nav-items">
          {NAV.map((n) => {
            const on = screen === n.id || (n.id === 'history' && screen === 'report')
            return (
              <button key={n.id} className={`nav ${on ? 'on' : ''}`} onClick={() => go(n.id)} aria-current={on ? 'page' : undefined}>
                <Icon name={n.icon} size={20} />
                <span>{t(lang, n.key)}</span>
                {n.id === 'live' && active && <span className="nav-live" />}
              </button>
            )
          })}
        </div>
        <div className="side-promo">
          <span className="promo-icon"><Icon name="shieldCheck" size={20} /></span>
          <b>{t(lang, 'promoTitle')}</b>
          <small>{t(lang, 'promoBody')}</small>
        </div>
      </nav>

      <main className="main">
        {error && (
          <div className="toast" role="alert" onClick={() => setError('')}>
            <Icon name="alert" size={18} /> <span>{error}</span> <Icon name="x" size={16} />
          </div>
        )}
        {screen === 'live' && (
          <>
            {hero}
            {livePanel}
            {howItWorks}
          </>
        )}
        {screen === 'history' && historyScreen}
        {screen === 'settings' && settingsScreen}
        {screen === 'help' && helpScreen}
        {screen === 'report' && shownReport && (
          <ReportView report={shownReport} lang={lang} onBack={() => go('history')}
            onNew={() => { setState(EMPTY); setLines([]); setAlert(null); go('live') }} />
        )}
      </main>

      {showRail && rail}

      {overlay && <AlertBanner alert={alert} lang={lang} onDismiss={() => setOverlay(false)} onHangUp={endCall} />}
    </div>
  )
}
