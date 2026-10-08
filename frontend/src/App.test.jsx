import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

vi.mock('./api.js', () => ({
  api: {
    health: () => Promise.resolve({ ok: true, l2: 'char-ngram', l3: null, stt: { ready: false } }),
    scenarios: () => Promise.resolve([{ id: 'inspector_sharma', title: 'Inspector Sharma' }]),
    scenario: () => Promise.reject(new Error('not used')),
  },
  GuardSocket: class {},
}))

const report = (id, peak) => ({
  call_id: id, started_at: '2026-10-08T10:00:00', duration: '00:40', caller_number: `+91 ${id}`, peak_score: peak,
  tactics: [], entities: {}, complaint_text: `complaint ${id}`,
})

function seedHistory(...reports) {
  localStorage.setItem('jam-history', JSON.stringify(reports.map((r) => ({ call_id: r.call_id, started_at: r.started_at, peak_score: r.peak_score, report: r }))))
}

async function renderApp() {
  render(<App />)
  await act(async () => {}) // let health / scenarios resolve
}

// jsdom doesn't fire hashchange synchronously; dispatch it the way a browser would.
async function navigateTo(hash) {
  await act(async () => {
    location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

const nav = (name) => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name })

describe('App', () => {
  it('starts on the live call page with the server status', async () => {
    await renderApp()
    expect(screen.getByText('NO ACTIVE CALL')).toBeTruthy()
    expect(screen.getByText('Protection active')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Microphone \(call on speaker\)/ }).disabled).toBe(true)
  })

  it('navigates between pages through the sidebar and the URL hash', async () => {
    await renderApp()
    fireEvent.click(nav('Settings'))
    await navigateTo(location.hash)
    expect(location.hash).toBe('#/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    await navigateTo('#/help')
    expect(screen.getByText(/Real police and agencies never/)).toBeTruthy()
  })

  it('opens a report from its URL and falls back to the list for unknown ids', async () => {
    seedHistory(report('a1', 92))
    location.hash = '#/report/a1'
    await renderApp()
    expect(screen.getByRole('heading', { name: 'Incident report' })).toBeTruthy()
    expect(screen.getByText('complaint a1')).toBeTruthy()
    await navigateTo('#/report/missing')
    await navigateTo(location.hash)
    expect(location.hash).toBe('#/history')
  })

  it('deletes one incident, then all of them after confirming', async () => {
    seedHistory(report('a1', 92), report('b2', 10))
    location.hash = '#/history'
    await renderApp()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete:/ })[0])
    expect(screen.queryByText('+91 a1')).toBeNull()
    expect(JSON.parse(localStorage.getItem('jam-history')).map((h) => h.call_id)).toEqual(['b2'])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Delete all/ }))
    expect(screen.getByText('No incidents yet')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('jam-history'))).toEqual([])
  })

  it('switches the whole UI language and html lang', async () => {
    await renderApp()
    fireEvent.click(screen.getAllByRole('button', { name: 'తెలుగు' })[0])
    expect(document.documentElement.lang).toBe('te')
    expect(screen.getByText('కాల్ లేదు')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('jam-settings')).lang).toBe('te')
  })
})
