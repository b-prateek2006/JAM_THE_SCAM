import { useEffect, useState } from 'react'
import { api } from './api.js'
import { browserSttSupported } from './audio/browserStt.js'
import AlertBanner from './components/AlertBanner.jsx'
import HeroPhone, { ScammerAvatar } from './components/HeroPhone.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import Icon from './components/Icon.jsx'
import LangSwitch from './components/LangSwitch.jsx'
import ReportView from './components/ReportView.jsx'
import RiskMeter from './components/RiskMeter.jsx'
import SideRail from './components/SideRail.jsx'
import StageTrack from './components/StageTrack.jsx'
import Transcript from './components/Transcript.jsx'
import { useGuardCall } from './hooks/useGuardCall.js'
import { callStatus, familyWhatsApp, fmtClock, hardRuleText } from './lib/format.js'
import { t } from './lib/i18n.js'
import { loadHistory, loadSettings, removeFromHistory, saveSettings, saveToHistory, writeHistory } from './lib/storage.js'
import { useHashRoute } from './lib/route.js'
import HelpScreen from './screens/HelpScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'

const LEVEL_KEY = ['safe', 'caution', 'warning', 'critical']

const NAV = [
  { id: 'live', icon: 'phone', key: 'liveCall' },
  { id: 'history', icon: 'clock', key: 'history' },
  { id: 'settings', icon: 'settings', key: 'settings' },
  { id: 'help', icon: 'help', key: 'help' },
]

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [route, go] = useHashRoute()
  const [health, setHealth] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [history, setHistory] = useState(loadHistory)
  const [report, setReport] = useState(null)
  const [file, setFile] = useState(null)
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

  function onReport(r) {
    setReport(r)
    setHistory(saveToHistory(r))
    go('report', r.call_id)
    refresh()
  }

  const call = useGuardCall({ settings, file, micReady, onReport })
  const { active, state, lines, interim, alert, overlay, error, level, elapsed, setError } = call

  async function startGuard() {
    if (await call.start()) go('live')
  }
  const endCall = call.end

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
  const langSwitch = (className = '') => <LangSwitch lang={lang} onChange={setLang} disabled={active} className={className} />

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
            <HowItWorks lang={lang} />
          </>
        )}
        {screen === 'history' && (
          <HistoryScreen lang={lang} history={history} onOpen={(id) => go('report', id)}
            onDelete={deleteIncident} onClear={clearHistory} onStart={() => go('live')} />
        )}
        {screen === 'settings' && <SettingsScreen lang={lang} settings={settings} set={set} onLang={setLang} locked={active} health={health} />}
        {screen === 'help' && <HelpScreen lang={lang} />}
        {screen === 'report' && shownReport && (
          <ReportView report={shownReport} lang={lang} onBack={() => go('history')}
            onNew={() => { call.reset(); go('live') }} />
        )}
      </main>

      {showRail && (
        <SideRail lang={lang} active={active} callerNumber={settings.caller_number} status={status} elapsed={elapsed}
          tacticCount={state.tactics.length} waLink={waLink} onHangUp={endCall}
          onAddContact={() => go('settings')} onPrepareComplaint={prepareComplaint} />
      )}

      {overlay && <AlertBanner alert={alert} lang={lang} onDismiss={call.dismissOverlay} onHangUp={endCall} />}
    </div>
  )
}
