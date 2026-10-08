import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

const STEPS = [
  { icon: 'mic', n: 1, tone: 'violet' },
  { icon: 'waves', n: 2, tone: 'teal' },
  { icon: 'brain', n: 3, tone: 'indigo' },
  { icon: 'shield', n: 4, tone: 'pink' },
]

// Capture → Transcribe → Understand → Act, as floating-icon cards.
export default function HowItWorks({ lang }) {
  return (
    <section className="how">
      <div className="how-intro">
        <h2>{t(lang, 'howItWorks')}</h2>
        <p className="muted">{t(lang, 'howSub')}</p>
      </div>
      <div className="steps">
        {STEPS.map((s) => (
          <div key={s.n} className="step">
            <span className={`step-icon ${s.tone}`}><Icon name={s.icon} size={24} /></span>
            <b>{s.n}. {t(lang, `step${s.n}t`)}</b>
            <p>{t(lang, `step${s.n}b`)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
