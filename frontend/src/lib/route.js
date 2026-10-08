import { useEffect, useState } from 'react'

// Hash routes (#/history, #/report/<call_id>, ...) so Back and reload work without a router.
export const SCREENS = ['live', 'history', 'settings', 'help', 'report']

export function parseHash(hash = location.hash) {
  const [screen, id] = hash.replace(/^#\/?/, '').split('/')
  return { screen: SCREENS.includes(screen) ? screen : 'live', id: id ? decodeURIComponent(id) : '' }
}

export function hashFor(screen, id) {
  return screen === 'live' ? '#/' : `#/${screen}${id ? '/' + encodeURIComponent(id) : ''}`
}

// Returns the current route and go(screen, id?, { scroll }) which pushes a history entry.
export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash())
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (screen, id, { scroll = true } = {}) => {
    const hash = hashFor(screen, id)
    if (location.hash !== hash) location.hash = hash
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return [route, go]
}
