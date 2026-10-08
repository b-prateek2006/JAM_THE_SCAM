import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

const NAV = [
  { id: 'live', icon: 'phone', key: 'liveCall' },
  { id: 'history', icon: 'clock', key: 'history' },
  { id: 'settings', icon: 'settings', key: 'settings' },
  { id: 'help', icon: 'help', key: 'help' },
]

// Purple side navigation (a bottom bar on phones). A report counts as part of Past incidents.
export default function Sidebar({ lang, screen, live, onNavigate }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="nav-items">
        {NAV.map((n) => {
          const on = screen === n.id || (n.id === 'history' && screen === 'report')
          return (
            <button key={n.id} className={`nav ${on ? 'on' : ''}`} onClick={() => onNavigate(n.id)} aria-current={on ? 'page' : undefined}>
              <Icon name={n.icon} size={20} />
              <span>{t(lang, n.key)}</span>
              {n.id === 'live' && live && <span className="nav-live" />}
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
  )
}
