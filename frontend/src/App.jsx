import { useEffect, useState } from 'react'
import { api } from './api.js'
import AlertBanner from './components/AlertBanner.jsx'
import GuardHero from './components/GuardHero.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import Icon from './components/Icon.jsx'
import LivePanel from './components/LivePanel.jsx'
import ReportView from './components/ReportView.jsx'
import SideRail from './components/SideRail.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import { useGuardCall } from './hooks/useGuardCall.js'
import { callStatus, familyWhatsApp } from './lib/format.js'
import { t } from './lib/i18n.js'
import { loadHistory, loadSettings, removeFromHistory, saveSettings, saveToHistory, writeHistory } from './lib/storage.js'
import { useHashRoute } from './lib/route.js'
import HelpScreen from './screens/HelpScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'

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

  return (
    <div className={`shell level-${lvl} ${active ? 'calling' : ''} ${showRail ? '' : 'no-rail'}`}>
      <TopBar lang={lang} onLang={setLang} locked={active} online={online} userName={settings.user_name} onAvatar={() => go('settings')} />
      <Sidebar lang={lang} screen={screen} live={active} onNavigate={go} />

      <main className="main">
        {error && (
          <div className="toast" role="alert" onClick={() => setError('')}>
            <Icon name="alert" size={18} /> <span>{error}</span> <Icon name="x" size={16} />
          </div>
        )}
        {screen === 'live' && (
          <>
            <GuardHero lang={lang} active={active} settings={settings} set={set} scenarios={scenarios} micReady={micReady}
              tactics={state.tactics} onFile={setFile} onStart={startGuard} onStop={endCall} />
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
