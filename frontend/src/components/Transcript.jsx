import { useEffect, useRef } from 'react'

function fmt(t) {
  const s = Math.max(0, Math.round(t || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Transcript({ lines, interim }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [lines.length, interim])
  return (
    <div className="transcript">
      {lines.map((l, i) => (
        <div key={i} className={`line ${l.speaker} ${l.hits?.length ? 'flagged' : ''}`}>
          <span className="ts">{fmt(l.t)}</span>
          <span className="who">{l.speaker === 'user' ? 'You' : l.speaker === 'caller' ? 'Caller' : '·'}</span>
          <span className="txt">{l.text}</span>
          {l.hits?.length > 0 && <span className="hit">{l.hits.map((h) => h.replace('_', ' ').toLowerCase()).join(', ')}</span>}
        </div>
      ))}
      {interim && <div className="line interim"><span className="txt">{interim}</span></div>}
      <div ref={end} />
    </div>
  )
}
