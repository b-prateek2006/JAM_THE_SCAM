import { useEffect, useRef } from 'react'
import { t } from '../lib/i18n.js'

function fmt(s) {
  s = Math.max(0, Math.round(s || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const WHO = { user: 'you', caller: 'callerWho' }

// labels maps tactic codes (AUTHORITY, …) to the backend's localized labels.
export default function Transcript({ lines, interim, emptyText, lang, labels = {} }) {
  const box = useRef(null)
  useEffect(() => {
    // Scroll the transcript box itself, not the page, so the dashboard doesn't jump during a call.
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines.length, interim])
  return (
    <div className="transcript" ref={box} role="log" aria-live="polite" aria-relevant="additions">
      {lines.length === 0 && !interim && <p className="muted small empty">{emptyText}</p>}
      {lines.map((l, i) => (
        <div key={i} className={`line ${l.speaker} ${l.hits?.length ? 'flagged' : ''}`}>
          <span className="ts">{fmt(l.t)}</span>
          <span className="bullet" />
          <span className="txt">
            <b>{t(lang, WHO[l.speaker] || 'voice')}:</b> {l.text}
          </span>
          {l.hits?.length > 0 && (
            <span className="hit">{l.hits.map((h) => labels[h] || h.replace(/_/g, ' ').toLowerCase()).join(', ')}</span>
          )}
        </div>
      ))}
      {interim && (
        <div className="line interim" aria-hidden="true">
          <span className="ts">…</span><span className="bullet" /><span className="txt">{interim}</span>
        </div>
      )}
    </div>
  )
}
