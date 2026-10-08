import { ScammerAvatar } from './HeroPhone.jsx'
import Icon from './Icon.jsx'
import LangSwitch from './LangSwitch.jsx'
import RiskMeter from './RiskMeter.jsx'
import StageTrack from './StageTrack.jsx'
import Transcript from './Transcript.jsx'
import { fmtClock, hardRuleText } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const LEVEL_KEY = ['safe', 'caution', 'warning', 'critical']

// Inline alert under the gauge: ready / listening, caution, warning, or HANG UP NOW.
function AlertCallout({ lang, level, active, alert, explanation }) {
  if (level >= 3) {
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
  if (level >= 1) {
    return (
      <div className={`callout ${level === 2 ? 'warn' : 'caution'}`}>
        <span className="callout-icon"><Icon name="triangle" size={20} /></span>
        <div>
          <span className="eyebrow">{t(lang, LEVEL_KEY[level])}</span>
          <p>{alert?.message || explanation}</p>
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
}

// The live-call card: caller, risk ring and alert on the left; scam stages and transcript on the right.
export default function LivePanel({ lang, onLang, active, state, lines, interim, alert, level, elapsed, callerNumber, status }) {
  const lvl = state.level
  const levelLabel = active || state.score > 0 ? t(lang, LEVEL_KEY[lvl] || 'safe') : ''
  const tacticLabels = Object.fromEntries(state.tactics.map((x) => [x.type, x.label]))
  return (
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
            <span className="caller-num">{callerNumber || t(lang, 'unknownNumber')}</span>
            <span className={`status-pill ${status[1]}`}>{t(lang, status[0])}</span>
          </div>
        </div>
        <RiskMeter score={state.score} label={levelLabel} caption={t(lang, 'riskScore')} />
        {state.hard_rule && <p className="hard-rule">{t(lang, 'hardRule')}: {hardRuleText(state.hard_rule, tacticLabels)}</p>}
        <AlertCallout lang={lang} level={lvl} active={active} alert={alert} explanation={state.explanation} />
      </div>
      <div className="live-right">
        <h3 className="card-title">{t(lang, 'stages')}</h3>
        <StageTrack tactics={state.tactics} lang={lang} />
        <div className="transcript-head">
          <h3 className="card-title">{t(lang, 'transcript')} {active && <span className="live-dot">{t(lang, 'liveDot')}</span>}</h3>
          <LangSwitch lang={lang} onChange={onLang} disabled={active} className="small" />
        </div>
        <Transcript lines={lines} interim={interim} lang={lang} labels={tacticLabels} emptyText={active ? t(lang, 'listening') : t(lang, 'idle')} />
        <div className={`listening ${active ? 'on' : ''}`}>
          <Icon name="waves" size={16} /> {t(lang, active ? 'listeningCall' : 'micOff')}
        </div>
      </div>
    </section>
  )
}
