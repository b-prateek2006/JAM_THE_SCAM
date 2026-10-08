import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// Hook → Authority → Isolation → Threat → Money ask: the scam's script as it unfolds.
const STAGES = [
  { key: 'stHook', types: ['ACCUSATION'], sev: 'medium' },
  { key: 'stAuthority', types: ['AUTHORITY'], sev: 'medium' },
  { key: 'stIsolation', types: ['ISOLATION'], sev: 'high' },
  { key: 'stThreat', types: ['ARREST_THREAT', 'URGENCY'], sev: 'high' },
  { key: 'stMoney', types: ['MONEY_ASK', 'REMOTE_ACCESS', 'CREDENTIAL'], sev: 'critical' },
]
const SEV_KEY = { medium: 'sevMedium', high: 'sevHigh', critical: 'sevCritical' }

export default function StageTrack({ tactics, lang }) {
  const byType = Object.fromEntries(tactics.map((x) => [x.type, x]))
  return (
    <ol className="stages">
      {STAGES.map((s) => {
        const hits = s.types.map((k) => byType[k]).filter(Boolean)
        const on = hits.length > 0
        return (
          <li key={s.key} className={on ? `on sev-${s.sev}` : ''}>
            <span className="stage-dot">
              {on && <Icon name={s.sev === 'medium' ? 'check' : 'alert'} size={14} strokeWidth={3} />}
            </span>
            <div className="stage-body">
              <div className="stage-head">
                <b>{t(lang, s.key)}</b>
                {on && <span className={`sev ${s.sev}`}>{t(lang, SEV_KEY[s.sev])}</span>}
              </div>
              {on ? (
                <>
                  <q title={hits.map((h) => `${h.label} · ${h.layers} · ${Math.round(h.confidence * 100)}%`).join('\n')}>
                    {hits[0].evidence}
                  </q>
                  {hits.length > 1 && <span className="stage-more">{hits.map((h) => h.label).join(' · ')}</span>}
                </>
              ) : (
                <span className="stage-wait">{t(lang, 'notDetected')}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
