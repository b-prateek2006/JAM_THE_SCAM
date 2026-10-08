import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// Level 2: full-screen warning. Level 3: critical takeover with hang-up + family alert.
// (Level 1 shows inline in the live-call panel instead.)
// It's a modal: focus moves to the main button, Tab stays inside, and Esc dismisses a
// warning but not a critical alert (that one needs a deliberate choice).
export default function AlertBanner({ alert, lang, onDismiss, onHangUp }) {
  const card = useRef(null)
  const primary = useRef(null)
  const crit = alert?.level >= 3

  useEffect(() => {
    const prev = document.activeElement
    primary.current?.focus()
    return () => prev?.focus?.()
  }, [alert?.level])

  if (!alert || alert.level < 2) return null

  function onKeyDown(e) {
    if (e.key === 'Escape' && !crit) {
      e.preventDefault()
      onDismiss()
    } else if (e.key === 'Tab') {
      const items = [...card.current.querySelectorAll('a[href], button:not([disabled])')]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className={`takeover ${crit ? 'crit' : 'warn'}`} role="alertdialog" aria-modal="true"
      aria-labelledby="takeover-title" aria-describedby="takeover-msg" onKeyDown={onKeyDown}>
      <div className="takeover-card" ref={card}>
        <div className="takeover-icon"><Icon name={crit ? 'phoneOff' : 'triangle'} size={34} /></div>
        <span className="eyebrow">{crit ? t(lang, 'highRisk') : t(lang, 'warning')}</span>
        <h2 id="takeover-title">{crit ? t(lang, 'hangUpShout') : t(lang, 'warning')}</h2>
        <p className="takeover-msg" id="takeover-msg">{alert.message}</p>
        {alert.spoken && <p className="takeover-spoken">{alert.spoken}</p>}
        {crit && alert.family && (
          <div className="family">
            <span><Icon name="users" size={16} /> {t(lang, 'familyAlerted')}{alert.family.sms?.sent ? ` · ${t(lang, 'smsSent')}` : ''}</span>
            <a className="btn soft" href={alert.family.whatsapp_link} target="_blank" rel="noreferrer">
              <Icon name="message" size={16} /> {t(lang, 'sendWhatsApp')}
            </a>
          </div>
        )}
        <div className="takeover-actions">
          {crit && (
            <button ref={primary} className="btn danger big" onClick={onHangUp}>
              <Icon name="phoneOff" size={18} /> {t(lang, 'hangUp')}
            </button>
          )}
          <button ref={crit ? undefined : primary} className="btn ghost big" onClick={onDismiss}>{t(lang, 'dismiss')}</button>
        </div>
      </div>
    </div>
  )
}
