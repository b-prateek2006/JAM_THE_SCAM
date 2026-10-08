import { useEffect, useState } from 'react'
import { api } from './api.js'
import { browserSttSupported } from './audio/browserStt.js'
import AlertBanner from './components/AlertBanner.jsx'
import HeroPhone from './components/HeroPhone.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import Icon from './components/Icon.jsx'
import LangSwitch from './components/LangSwitch.jsx'
import LivePanel from './components/LivePanel.jsx'
import ReportView from './components/ReportView.jsx'
import SideRail from './components/SideRail.jsx'
import { useGuardCall } from './hooks/useGuardCall.js'
import { callStatus, familyWhatsApp } from './lib/format.js'
import { t } from './lib/i18n.js'
import { loadHistory, loadSettings, removeFromHistory, saveSettings, saveToHistory, writeHistory } from './lib/storage.js'
import { useHashRoute } from './lib/route.js'
import HelpScreen from './screens/HelpScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'

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
  const waLink = alert?.family?.whatsapp_link || familyWhatsApp(settings.family_phone, settings.user_name)
  const online = !!health?.ok
  const status = callStatus(lvl, active)
  const showRail = screen === 'live' || screen === 'report'
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
            <LivePanel lang={lang} onLang={setLang} active={active} state={state} lines={lines} interim={interim}
              alert={alert} level={level} elapsed={elapsed} callerNumber={settings.caller_number} status={status} />
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
