import Icon from './Icon.jsx'
import { fmtClock } from '../lib/format.js'
import { t } from '../lib/i18n.js'

const WHY = [
  { icon: 'mic', key: 'why1' },
  { icon: 'brain', key: 'why2' },
  { icon: 'shield', key: 'why3' },
]

// Right-hand column: quick actions, caller details and "why it works".
// waLink is the family WhatsApp link, or '' when no family contact is set.
export default function SideRail({ lang, active, callerNumber, status, elapsed, tacticCount, waLink,
  onHangUp, onAddContact, onPrepareComplaint }) {
  return (
    <aside className="rail">
      <section className="card">
        <h3 className="card-title lg">{t(lang, 'quickActions')}</h3>
        <div className="actions">
          <button className="action hang" onClick={onHangUp} disabled={!active}>
            <span className="action-icon"><Icon name="phoneOff" size={22} /></span>
            <span><b>{t(lang, 'hangUpNow')}</b><small>{t(lang, active ? 'hangUpSubActive' : 'hangUpSubIdle')}</small></span>
          </button>
          {waLink ? (
            <a className="action family" href={waLink} target="_blank" rel="noreferrer">
              <span className="action-icon"><Icon name="users" size={22} /></span>
              <span><b>{t(lang, 'alertFamily')}</b><small>{t(lang, 'sendWhatsApp')}</small></span>
            </a>
          ) : (
            <button className="action family" onClick={onAddContact}>
              <span className="action-icon"><Icon name="users" size={22} /></span>
              <span><b>{t(lang, 'alertFamily')}</b><small>{t(lang, 'needContact')}</small></span>
            </button>
          )}
          <button className="action complaint" onClick={onPrepareComplaint}>
            <span className="action-icon"><Icon name="file" size={22} /></span>
            <span><b>{t(lang, 'prepareComplaint')}</b><small>1930 / cybercrime.gov.in</small></span>
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title lg"><Icon name="user" size={18} /> {t(lang, 'callerDetails')}</h3>
        <dl className="details">
          <div><dt>{t(lang, 'number')}</dt><dd className="mono">{callerNumber || t(lang, 'unknown')}</dd></div>
          <div><dt>{t(lang, 'status')}</dt><dd><span className={`status-pill ${status[1]}`}>{t(lang, status[0])}</span></dd></div>
          <div><dt>{t(lang, 'duration')}</dt><dd className="mono">{fmtClock(elapsed)}</dd></div>
          <div><dt>{t(lang, 'tactics')}</dt><dd>{tacticCount}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h3 className="card-title lg">{t(lang, 'whyItWorks')}</h3>
        <ul className="why">
          {WHY.map((w) => (
            <li key={w.key}><span className="why-icon"><Icon name={w.icon} size={20} /></span>{t(lang, w.key)}</li>
          ))}
        </ul>
        <div className="safer">
          <span className="safer-icon"><Icon name="sprout" size={22} /></span>
          <div><b>{t(lang, 'saferTitle')}</b><small>{t(lang, 'saferSub')}</small></div>
        </div>
      </section>
    </aside>
  )
}
