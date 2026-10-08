import Icon from '../components/Icon.jsx'
import { riskColor } from '../components/RiskMeter.jsx'
import { t } from '../lib/i18n.js'

// Past incidents stored on this device, newest first, each deletable.
export default function HistoryScreen({ lang, history, onOpen, onDelete, onClear, onStart }) {
  return (
    <div className="page">
      <div className="page-head spread">
        <div><span className="eyebrow">{t(lang, 'onDevice')}</span><h2>{t(lang, 'history')}</h2></div>
        {history.length > 0 && (
          <button className="btn ghost small danger-text" onClick={onClear}><Icon name="x" size={14} /> {t(lang, 'clearAll')}</button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="card empty-state">
          <span className="tile-icon"><Icon name="inbox" size={22} /></span>
          <b>{t(lang, 'noIncidents')}</b>
          <p className="muted">{t(lang, 'noIncidentsBody')}</p>
          <button className="btn primary" onClick={onStart}>{t(lang, 'guard')}</button>
        </div>
      ) : (
        <ul className="incidents">
          {history.map((h) => {
            const c = riskColor(h.peak_score)
            const when = new Date(h.started_at).toLocaleString()
            return (
              <li key={h.call_id}>
                <button className="inc-open" onClick={() => onOpen(h.call_id)}>
                  <span className="inc-score" style={{ color: c, borderColor: c }}>{h.peak_score}</span>
                  <span className="inc-body">
                    <b>{h.report?.caller_number || t(lang, 'unknownCaller')}</b>
                    <small>{when} · {h.report?.duration || ''} · {t(lang, 'nTactics', { n: h.report?.tactics?.length || 0 })}</small>
                  </span>
                  <Icon name="chevronRight" />
                </button>
                <button className="inc-delete" onClick={() => onDelete(h.call_id)} aria-label={`${t(lang, 'delete')}: ${when}`}>
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
}
