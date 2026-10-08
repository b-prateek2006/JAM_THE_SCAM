import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount rendered components and reset per-test browser state.
afterEach(() => {
  cleanup()
  localStorage.clear()
  location.hash = ''
})
