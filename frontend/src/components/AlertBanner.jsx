import { t } from '../lib/i18n.js'

// Level 1: banner. Level 2: full-screen warning. Level 3: critical takeover with hang-up + family alert.
export default function AlertBanner({ alert, lang, onDismiss, onHangUp }) {
  if (!alert) return null
  if (alert.level === 1) {
    return (
      <div className="banner caution" role="status">
        <b>{t(lang, 'caution')}.</b> {alert.message}
      </div>
    )
  }
  const crit = alert.level >= 3
  return (
    <div className={`takeover ${crit ? 'crit' : 'warn'}`} role="alertdialog" aria-live="assertive">
      <div className="takeover-inner">
        <div className="takeover-icon">{crit ? '⛔' : '⚠️'}</div>
        <h2>{crit ? 'HANG UP NOW' : t(lang, 'warning')}</h2>
        <p className="takeover-msg">{alert.message}</p>
        {alert.spoken && <p className="muted">{alert.spoken}</p>}
        {crit && alert.family && (
          <div className="family">
            <div>👪 {t(lang, 'familyAlerted')}{alert.family.sms?.sent ? ' · SMS sent' : ''}</div>
            <a className="btn ghost" href={alert.family.whatsapp_link} target="_blank" rel="noreferrer">
              {t(lang, 'sendWhatsApp')}
            </a>
          </div>
        )}
        <div className="row">
          {crit && <button className="btn danger big" onClick={onHangUp}>{t(lang, 'hangUp')}</button>}
          <button className="btn ghost" onClick={onDismiss}>{t(lang, 'dismiss')}</button>
        </div>
      </div>
    </div>
  )
}
