import LangSwitch from '../components/LangSwitch.jsx'
import { t } from '../lib/i18n.js'
import { THEMES } from '../lib/theme.js'

const THEME_KEY = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' }

// set(key) returns an onChange handler for that setting (checkboxes use .checked).
export default function SettingsScreen({ lang, settings, set, onLang, onTheme, locked, health }) {
  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">{t(lang, 'savedOnDevice')}</span><h2>{t(lang, 'settings')}</h2></div></div>
      <div className="settings-grid">
        <section className="card">
          <h3 className="card-title">{t(lang, 'youAndFamily')}</h3>
          <label className="field">{t(lang, 'yourName')}<input value={settings.user_name} onChange={set('user_name')} placeholder="Lakshmi" /></label>
          <label className="field">{t(lang, 'family')}<input value={settings.family_phone} onChange={set('family_phone')} placeholder="98xxxxxxxx" inputMode="tel" /></label>
          <label className="field">{t(lang, 'caller')}<input value={settings.caller_number} onChange={set('caller_number')} placeholder="+91…" inputMode="tel" /></label>
        </section>
        <section className="card">
          <h3 className="card-title">{t(lang, 'langDetection')}</h3>
          <div className="field">{t(lang, 'language')}<LangSwitch lang={lang} onChange={onLang} disabled={locked} /></div>
          <div className="field">{t(lang, 'appearance')}
            <div className="seg" role="group" aria-label={t(lang, 'appearance')}>
              {THEMES.map((th) => (
                <button key={th} className={settings.theme === th ? 'on' : ''} aria-pressed={settings.theme === th}
                  onClick={() => onTheme(th)}>{t(lang, THEME_KEY[th])}</button>
              ))}
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={settings.use_l3} onChange={set('use_l3')} /> {t(lang, 'useL3')}</label>
          <label className="check"><input type="checkbox" checked={settings.voice_demo} onChange={set('voice_demo')} /> {t(lang, 'readAloud')}</label>
          {health && (
            <div className="engine" aria-label={t(lang, 'engine')}>
              <span>L1 lexicon</span>
              <span>L2 {health.l2 || 'off'}</span>
              <span>L3 {health.l3 ? health.l3.provider : 'off'}</span>
              <span>STT {health.stt?.ready ? health.stt.name : 'browser'}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
