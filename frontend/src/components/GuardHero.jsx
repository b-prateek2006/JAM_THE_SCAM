import HeroPhone from './HeroPhone.jsx'
import Icon from './Icon.jsx'
import { browserSttSupported } from '../audio/browserStt.js'
import { t } from '../lib/i18n.js'

// Purple hero card: pitch, call-source setup and the start / stop button.
export default function GuardHero({ lang, active, connecting, settings, set, scenarios, micReady, tactics, onFile, onStart, onStop }) {
  return (
    <section className={`hero ${active ? 'is-active' : ''}`}>
      <div className="hero-copy">
        <span className="eyebrow light">{t(lang, 'heroEyebrow')}</span>
        <h1>{t(lang, 'heroTitle')}</h1>
        <p>{t(lang, 'heroBody')}</p>
        {active ? (
          <button className="btn hero-btn stop" onClick={onStop}><Icon name="phoneOff" size={18} /> {t(lang, 'endCall')}</button>
        ) : (
          <>
            <div className="hero-setup">
              <label>
                <span>{t(lang, 'source')}</span>
                <select value={settings.source} onChange={set('source')}>
                  <option value="demo">{t(lang, 'demo')}</option>
                  <option value="mic" disabled={!micReady}>{t(lang, 'mic')}</option>
                  <option value="browser" disabled={!browserSttSupported()}>{t(lang, 'browser')}</option>
                  <option value="file">{t(lang, 'file')}</option>
                </select>
              </label>
              {settings.source === 'demo' && (
                <label>
                  <span>{t(lang, 'scenario')}</span>
                  <select value={settings.scenario} onChange={set('scenario')}>
                    {scenarios.length === 0 && <option value={settings.scenario}>{settings.scenario}</option>}
                    {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>
              )}
              {settings.source === 'file' && (
                <label>
                  <span>{t(lang, 'audioFile')}</span>
                  <input type="file" accept="audio/*" onChange={(e) => onFile(e.target.files[0] || null)} />
                </label>
              )}
            </div>
            {settings.source === 'mic' && !micReady && <p className="hero-note">{t(lang, 'sttUnavailable')}</p>}
            <button className="btn hero-btn" onClick={onStart} disabled={connecting}>
              <Icon name="shieldCheck" size={18} /> {t(lang, 'guard')} <Icon name="arrowRight" size={18} />
            </button>
          </>
        )}
      </div>
      <HeroPhone tactics={tactics} number={settings.caller_number} lang={lang} />
    </section>
  )
}
