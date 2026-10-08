// REST + WebSocket client for the FastAPI backend.

export async function getJSON(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}

export const api = {
  health: () => getJSON('/api/health'),
  scenarios: () => getJSON('/api/scenarios'),
  scenario: (id) => getJSON(`/api/scenarios/${encodeURIComponent(id)}`),
  incidents: () => getJSON('/api/incidents'),
  incident: (id) => getJSON(`/api/incidents/${encodeURIComponent(id)}`),
}

export class GuardSocket {
  constructor({ onMessage, onClose }) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${location.host}/ws/guard`)
    this.ws.binaryType = 'arraybuffer'
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = (e) => onMessage?.(JSON.parse(e.data))
    this.ws.onclose = () => onClose?.()
  }

  send(obj) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  sendAudio(int16) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(int16.buffer)
  }

  start(opts) {
    this.send({ type: 'start', ...opts })
  }

  text(text, speaker = 'unknown') {
    this.send({ type: 'text', text, speaker })
  }

  stop(keep = true, keepTranscript = false) {
    this.send({ type: 'stop', keep, keep_transcript: keepTranscript })
  }

  close() {
    try {
      this.ws.close()
    } catch {}
  }
}
