// Hero illustration: a ringing phone with the four scam tells floating around it.
// During a call each chip lights up when its tactic is detected.
import { t } from '../lib/i18n.js'

const CHIPS = [
  { key: 'chipAuthority', types: ['AUTHORITY'], cls: 'c1' },
  { key: 'chipSecrecy', types: ['ISOLATION'], cls: 'c2' },
  { key: 'chipThreat', types: ['ARREST_THREAT', 'URGENCY', 'ACCUSATION'], cls: 'c3' },
  { key: 'chipMoney', types: ['MONEY_ASK', 'REMOTE_ACCESS', 'CREDENTIAL'], cls: 'c4' },
]

export function ScammerAvatar({ size = 64 }) {
  return (
    <svg className="scammer" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#E4E0F7" />
      <path d="M10 64c1-14 9-22 22-22s21 8 22 22z" fill="#2B2848" />
      <path d="M15 34c0-12 7-21 17-21s17 9 17 21c0 6-3 10-6 12H21c-3-2-6-6-6-12z" fill="#2B2848" />
      <ellipse cx="32" cy="34" rx="11" ry="12" fill="#F2C9A6" />
      <rect x="20.5" y="28" width="23" height="7" rx="3.5" fill="#15132A" />
      <circle cx="27" cy="31.5" r="1.6" fill="#fff" />
      <circle cx="37" cy="31.5" r="1.6" fill="#fff" />
      <path d="M28 41c2.5 1.4 5.5 1.4 8 0" stroke="#B5846A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export default function HeroPhone({ tactics = [], number, lang }) {
  const seen = new Set(tactics.map((x) => x.type))
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-screen">
          <ScammerAvatar size={58} />
          <span className="phone-name">{t(lang, 'unknownCaller')}</span>
          <span className="phone-num">{number || '+91 98765 43210'}</span>
          <div className="phone-btns">
            <span className="pb accept" />
            <span className="pb decline" />
          </div>
        </div>
      </div>
      {CHIPS.map((c) => (
        <span key={c.key} className={`float-chip ${c.cls} ${c.types.some((k) => seen.has(k)) ? 'hit' : ''}`}>{t(lang, c.key)}</span>
      ))}
    </div>
  )
}
