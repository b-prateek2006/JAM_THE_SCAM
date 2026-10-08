// Hook → Authority → Isolation → Urgency → Money ask: the scam's script as it unfolds.
const STAGES = ['Hook', 'Authority', 'Isolation', 'Urgency', 'Money ask']
const STAGE_OF = {
  ACCUSATION: 1, AUTHORITY: 2, ISOLATION: 3, ARREST_THREAT: 4, URGENCY: 4,
  MONEY_ASK: 5, REMOTE_ACCESS: 5, CREDENTIAL: 5,
}

export default function StageTrack({ tactics }) {
  const reached = new Set(tactics.map((t) => STAGE_OF[t.type]))
  return (
    <ol className="stages">
      {STAGES.map((name, i) => (
        <li key={name} className={reached.has(i + 1) ? 'on' : ''}>
          <span className="dot" />
          <span>{name}</span>
        </li>
      ))}
    </ol>
  )
}
