import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { riskColor } from './RiskMeter.jsx'

const ENTITY_LABELS = {
  claimed_names: 'Claimed name', agencies: 'Agency claimed', phone_numbers: 'Phone numbers',
  upi_ids: 'UPI IDs', bank_accounts: 'Bank accounts', ifsc_codes: 'IFSC', badge_numbers: 'Badge / ID',
  fir_numbers: 'FIR / case no.', amounts: 'Amounts', apps_mentioned: 'Apps',
}

// navigator.clipboard only exists on secure origins; a phone opening the dev
// server over LAN http (vite host: true) needs the execCommand fallback.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error('Copy failed'))
}

export default function ReportView({ report, lang, onNew }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await copyText(report.complaint_text)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const entities = Object.entries(report.entities || {}).filter(([, v]) => v?.length)
  return (
    <div className="report">
      <h2>{t(lang, 'report')}</h2>
      <div className="stats">
        <div><span className="muted">Peak risk</span><b style={{ color: riskColor(report.peak_score) }}>{report.peak_score} / 100</b></div>
        <div><span className="muted">Duration</span><b>{report.duration}</b></div>
        <div><span className="muted">Caller</span><b>{report.caller_number || 'Unknown'}</b></div>
      </div>

      {entities.length > 0 && (
        <div className="card">
          <h3>What the caller gave away</h3>
          <dl className="entities">
            {entities.map(([k, v]) => (
              <div key={k}><dt>{ENTITY_LABELS[k] || k}</dt><dd>{v.join(', ')}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {report.tactics?.length > 0 && (
        <div className="card">
          <h3>Scam tactics, in order</h3>
          <ul className="timeline">
            {report.tactics.map((x) => (
              <li key={x.type}><span className="ts">{x.at}</span><b>{x.label}</b><q>{x.evidence}</q></li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h3>{t(lang, 'complaint')}</h3>
          <button className="btn small" onClick={copy}>{copied ? t(lang, 'copied') : t(lang, 'copy')}</button>
        </div>
        <pre className="complaint">{report.complaint_text}</pre>
        <div className="report-to">
          <a className="btn danger" href="tel:1930">Call 1930</a>
          <a className="btn ghost" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">cybercrime.gov.in</a>
          <a className="btn ghost" href="https://sancharsaathi.gov.in" target="_blank" rel="noreferrer">Chakshu</a>
        </div>
      </div>
      <button className="btn primary big" onClick={onNew}>{t(lang, 'newCall')}</button>
    </div>
  )
}
