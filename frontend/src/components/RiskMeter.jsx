// 0–100 semicircle gauge. Colour follows the alert thresholds (40 / 65 / 85).
export function riskColor(score) {
  if (score >= 85) return 'var(--crit)'
  if (score >= 65) return 'var(--warn)'
  if (score >= 40) return 'var(--caution)'
  return 'var(--ok)'
}

export default function RiskMeter({ score, label, sub }) {
  const r = 90
  const circ = Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const color = riskColor(score)
  return (
    <div className="meter">
      <svg viewBox="0 0 220 130" role="img" aria-label={`Risk ${score} of 100`}>
        <path d="M20 115 A90 90 0 0 1 200 115" className="meter-track" />
        <path
          d="M20 115 A90 90 0 0 1 200 115"
          className="meter-fill"
          style={{ stroke: color, strokeDasharray: `${circ * pct} ${circ}` }}
        />
        {[40, 65, 85].map((th) => {
          const a = Math.PI * (1 - th / 100)
          return (
            <line key={th} x1={110 + 78 * Math.cos(a)} y1={115 - 78 * Math.sin(a)}
              x2={110 + 100 * Math.cos(a)} y2={115 - 100 * Math.sin(a)} className="meter-tick" />
          )
        })}
        <text x="110" y="100" textAnchor="middle" className="meter-num" style={{ fill: color }}>
          {Math.round(score)}
        </text>
      </svg>
      <div className="meter-label" style={{ color }}>{label}</div>
      {sub && <div className="meter-sub">{sub}</div>}
    </div>
  )
}
