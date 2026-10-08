const ALL = ['AUTHORITY', 'ACCUSATION', 'ISOLATION', 'ARREST_THREAT', 'URGENCY', 'MONEY_ASK', 'REMOTE_ACCESS', 'CREDENTIAL']
const EN = {
  AUTHORITY: 'Authority claim', ACCUSATION: 'Accusation', ARREST_THREAT: 'Arrest threat',
  ISOLATION: 'Secrecy demand', URGENCY: 'Time pressure', MONEY_ASK: 'Money transfer ask',
  REMOTE_ACCESS: 'Remote-access app', CREDENTIAL: 'OTP / PIN request',
}

export default function TacticChips({ tactics, emptyText }) {
  const byType = Object.fromEntries(tactics.map((t) => [t.type, t]))
  return (
    <div>
      <div className="chips">
        {ALL.map((type) => {
          const t = byType[type]
          return (
            <span key={type} className={`chip ${t ? 'on' : ''} ${t && t.type.match(/MONEY|REMOTE|CREDENTIAL/) ? 'hot' : ''}`}
              title={t ? `"${t.evidence}" (${t.layers}, ${Math.round(t.confidence * 100)}%)` : ''}>
              {t?.label || EN[type]}
            </span>
          )
        })}
      </div>
      {tactics.length === 0 ? (
        <p className="muted small">{emptyText}</p>
      ) : (
        <ul className="evidence">
          {tactics.slice(-3).reverse().map((t) => (
            <li key={t.type}>
              <b>{t.label}</b> <span className="muted">· {t.layers}</span>
              <q>{t.evidence}</q>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
