import { useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'
import { riskColor } from './RiskMeter.jsx'

// navigator.clipboard only exists on HTTPS / localhost; a phone opening the app over the LAN
// falls back to the old execCommand path.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export default function ReportView({ report, lang, onNew, onBack }) {
  const [copyState, setCopyState] = useState('')
  const pre = useRef(null)

  async function copy() {
    if (await copyText(report.complaint_text)) {
      setCopyState('copied')
      setTimeout(() => setCopyState(''), 1500)
    } else {
      setCopyState('failed')
      const range = document.createRange()
      range.selectNodeContents(pre.current)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }

  async function share() {
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title: t(lang, 'report'), text: report.complaint_text })
    } catch {} // the user closed the share sheet
  }

  const entities = Object.entries(report.entities || {}).filter(([, v]) => v?.length)
  const color = riskColor(report.peak_score)
  const tacticCount = report.tactics?.length || 0
  return (
    <div className="report">
      <div className="page-head">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label={t(lang, 'back')}><Icon name="chevronLeft" /></button>}
        <div>
          <span className="eyebrow">{new Date(report.started_at).toLocaleString()}</span>
          <h2>{t(lang, 'report')}</h2>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-icon" style={{ background: color }}><Icon name="shield" size={22} /></span>
          <span className="muted small">{t(lang, 'peakRisk')}</span>
          <b style={{ color }}>{report.peak_score}<small>/100</small></b>
          <div className="bar"><span style={{ width: `${report.peak_score}%`, background: color }} /></div>
        </div>
        <div className="tile">
          <span className="tile-icon"><Icon name="clock" size={22} /></span>
          <span className="muted small">{t(lang, 'duration')}</span>
          <b>{report.duration}</b>
          <span className="muted small">{t(lang, 'nTactics', { n: tacticCount })}</span>
        </div>
        <div className="tile">
          <span className="tile-icon pink"><Icon name="phone" size={22} /></span>
          <span className="muted small">{t(lang, 'callerWho')}</span>
          <b className="mono">{report.caller_number || t(lang, 'unknown')}</b>
          <span className="muted small">{t(lang, report.peak_score >= 65 ? 'suspected' : 'noScam')}</span>
        </div>
      </div>

      <div className="report-grid">
        {tacticCount > 0 && (
          <section className="card">
            <h3>{t(lang, 'tacticsInOrder')}</h3>
            <ul className="timeline">
              {report.tactics.map((x) => (
                <li key={x.type}><span className="ts">{x.at}</span><div><b>{x.label}</b><q>{x.evidence}</q></div></li>
              ))}
            </ul>
          </section>
        )}
        {entities.length > 0 && (
          <section className="card">
            <h3>{t(lang, 'gaveAway')}</h3>
            <dl className="entities">
              {entities.map(([k, v]) => (
                <div key={k}><dt>{t(lang, `ent_${k}`)}</dt><dd>{v.join(', ')}</dd></div>
              ))}
            </dl>
          </section>
        )}
      </div>

      <section className="card" id="complaint">
        <div className="card-head">
          <h3>{t(lang, 'complaint')}</h3>
          <div className="row">
            <button className="btn soft small" onClick={copy}>
              <Icon name="copy" size={14} /> {copyState === 'copied' ? t(lang, 'copied') : t(lang, 'copy')}
            </button>
            <button className="btn soft small" onClick={share}><Icon name="upload" size={14} /> {t(lang, 'share')}</button>
          </div>
        </div>
        {copyState === 'failed' && <p className="copy-hint" role="status">{t(lang, 'selectToCopy')}</p>}
        <pre className="complaint" ref={pre}>{report.complaint_text}</pre>
        <div className="report-to">
          <a className="btn danger" href="tel:1930"><Icon name="phone" size={16} /> {t(lang, 'call1930')}</a>
          <a className="btn soft" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">cybercrime.gov.in <Icon name="external" size={14} /></a>
          <a className="btn soft" href="https://sancharsaathi.gov.in" target="_blank" rel="noreferrer">Chakshu <Icon name="external" size={14} /></a>
        </div>
      </section>
      {onNew && <button className="btn primary big" onClick={onNew}><Icon name="shieldCheck" size={18} /> {t(lang, 'newCall')}</button>}
    </div>
  )
}
