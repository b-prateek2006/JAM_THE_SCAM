import HowItWorks from '../components/HowItWorks.jsx'
import Icon from '../components/Icon.jsx'
import { t } from '../lib/i18n.js'

export default function HelpScreen({ lang }) {
  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">{t(lang, 'staySafe')}</span><h2>{t(lang, 'help')}</h2></div></div>
      <section className="card">
        <h3 className="card-title">{t(lang, 'neverTitle')}</h3>
        <ul className="never">
          {[1, 2, 3, 4].map((n) => <li key={n}><Icon name="x" size={16} /> {t(lang, `never${n}`)}</li>)}
        </ul>
      </section>
      <HowItWorks lang={lang} />
      <section className="card helplines">
        <h3 className="card-title">{t(lang, 'reportScam')}</h3>
        <div className="report-to">
          <a className="btn danger" href="tel:1930"><Icon name="phone" size={16} /> {t(lang, 'call1930')}</a>
          <a className="btn soft" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">cybercrime.gov.in <Icon name="external" size={14} /></a>
          <a className="btn soft" href="https://sancharsaathi.gov.in" target="_blank" rel="noreferrer">Sanchar Saathi Chakshu <Icon name="external" size={14} /></a>
        </div>
      </section>
    </div>
  )
}
