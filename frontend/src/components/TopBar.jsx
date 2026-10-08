import Icon from './Icon.jsx'
import LangSwitch from './LangSwitch.jsx'
import { t } from '../lib/i18n.js'

// Brand, server status pill, language switch and the avatar (opens Settings).
export default function TopBar({ lang, onLang, locked, online, userName, onAvatar }) {
  const initial = (userName || '').trim()[0]
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Icon name="phone" size={22} /></span>
        <div>
          <b>Jam the Scam</b>
          <small>{t(lang, 'tagline')}</small>
        </div>
      </div>
      <div className="top-right">
        <span className={`protect ${online ? 'on' : ''}`}><span className="dot" /> {online ? t(lang, 'protectionActive') : t(lang, 'offline')}</span>
        <LangSwitch lang={lang} onChange={onLang} disabled={locked} className="langs" />
        <button className="avatar" onClick={onAvatar} aria-label={t(lang, 'settings')}>
          {initial ? initial.toUpperCase() : <Icon name="user" size={18} />}
        </button>
      </div>
    </header>
  )
}
