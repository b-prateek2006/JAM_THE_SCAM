// 0–100 ring gauge. Colour follows the alert thresholds (40 / 65 / 85).
export function riskColor(score) {
  if (score >= 85) return 'var(--crit)'
  if (score >= 65) return 'var(--warn)'
  if (score >= 40) return 'var(--caution)'
  return 'var(--ok)'
}

const SWEEP = 300 // degrees of arc; the gap sits at the bottom

export default function RiskMeter({ score, label, caption = 'Risk score' }) {
  const r = 78
  const circ = 2 * Math.PI * r
  const arc = (circ * SWEEP) / 360
  const pct = Math.max(0, Math.min(100, score)) / 100
  const color = riskColor(score)
  const rot = 90 + (360 - SWEEP) / 2
  return (
    <div className="ring">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Risk ${Math.round(score)} of 100`}>
        <circle cx="100" cy="100" r={r} className="ring-track"
          strokeDasharray={`${arc} ${circ}`} transform={`rotate(${rot} 100 100)`} />
        <circle cx="100" cy="100" r={r} className="ring-fill"
          style={{ stroke: color, strokeDasharray: `${arc * pct} ${circ}` }} transform={`rotate(${rot} 100 100)`} />
      </svg>
      <div className="ring-center">
        <b style={{ color }}>{Math.round(score)}</b>
        <span className="ring-of">/100</span>
        <span className="ring-cap">{caption}</span>
      </div>
      {label && <div className="ring-label" style={{ color }}>{label}</div>}
    </div>
  )
}
