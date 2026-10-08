import { LANGS, t } from '../lib/i18n.js'

// EN / हिन्दी / తెలుగు segmented control. Locked during a call, since the server
// session and spoken warnings are started in one language.
export default function LangSwitch({ lang, onChange, disabled = false, className = '' }) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={t(lang, 'language')}>
      {LANGS.map((l) => (
        <button key={l.code} lang={l.code} className={l.code === lang ? 'on' : ''} disabled={disabled}
          aria-pressed={l.code === lang} onClick={() => onChange(l.code)}>{l.label}</button>
      ))}
    </div>
  )
}
