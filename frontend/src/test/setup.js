import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom has no layout, so scrolling is a no-op rather than a "not implemented" error.
window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

// Unmount rendered components and reset per-test browser state.
afterEach(() => {
  cleanup()
  localStorage.clear()
  location.hash = ''
  delete document.documentElement.dataset.theme
})
