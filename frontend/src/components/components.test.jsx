import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AlertBanner from './AlertBanner.jsx'
import LivePanel from './LivePanel.jsx'
import ReportView from './ReportView.jsx'
import RiskMeter from './RiskMeter.jsx'
import StageTrack from './StageTrack.jsx'

afterEach(() => vi.restoreAllMocks())

describe('StageTrack', () => {
  it('marks reached stages with the caller quote and leaves the rest pending', () => {
    const tactics = [
      { type: 'AUTHORITY', label: 'Authority claim', evidence: 'I am from CBI', layers: 'L1', confidence: 0.9 },
      { type: 'MONEY_ASK', label: 'Money transfer ask', evidence: 'transfer 2 lakh', layers: 'L1', confidence: 0.95 },
    ]
    const { container } = render(<StageTrack tactics={tactics} lang="en" />)
    const reached = container.querySelectorAll('li.on')
    expect(reached).toHaveLength(2)
    expect(reached[0].textContent).toContain('I am from CBI')
    expect(container.querySelector('li.sev-critical').textContent).toContain('Critical')
    expect(screen.getAllByText('Not detected')).toHaveLength(3)
  })

  it('uses the chosen language', () => {
    render(<StageTrack tactics={[]} lang="hi" />)
    expect(screen.getAllByText('नहीं मिला')).toHaveLength(5)
  })
})

describe('RiskMeter', () => {
  it('shows the rounded score, caption and label', () => {
    render(<RiskMeter score={84.6} label="Warning" caption="Risk score" />)
    expect(screen.getByRole('img', { name: 'Risk 85 of 100' })).toBeTruthy()
    expect(screen.getByText('85')).toBeTruthy()
    expect(screen.getByText('Warning')).toBeTruthy()
  })
})

describe('AlertBanner', () => {
  const warn = { level: 2, message: 'Keep it secret?', spoken: '' }
  const crit = { level: 3, message: 'Hang up', spoken: '', family: { whatsapp_link: 'https://wa.me/91' } }

  it('renders nothing below level 2', () => {
    const { container } = render(<AlertBanner alert={{ level: 1 }} lang="en" onDismiss={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('focuses dismiss on a warning and closes it with Esc', () => {
    const onDismiss = vi.fn()
    render(<AlertBanner alert={warn} lang="en" onDismiss={onDismiss} onHangUp={() => {}} />)
    expect(document.activeElement.textContent).toContain("I'm safe")
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('focuses hang-up on a critical alert, ignores Esc and keeps Tab inside', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<AlertBanner alert={crit} lang="en" onDismiss={onDismiss} onHangUp={() => {}} />)
    const dialog = screen.getByRole('alertdialog')
    expect(document.activeElement.textContent).toContain('Hang up & report')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
    for (let i = 0; i < 5; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})

describe('ReportView', () => {
  const report = {
    call_id: 'c1', started_at: '2026-10-08T10:00:00', duration: '01:10', caller_number: '', peak_score: 92,
    tactics: [{ type: 'AUTHORITY', label: 'Authority claim', at: '00:05', evidence: 'CBI here' }],
    entities: { badge_numbers: ['CBI4521'], upi_ids: [] }, complaint_text: 'Subject: complaint',
  }

  it('shows tiles, tactics and localized entity labels', () => {
    render(<ReportView report={report} lang="en" />)
    expect(screen.getByText('Suspected scam')).toBeTruthy()
    expect(screen.getByText('CBI here')).toBeTruthy()
    expect(screen.getByText('Badge / ID')).toBeTruthy()
    expect(screen.queryByText('UPI IDs')).toBeNull()
  })

  it('copies with execCommand when navigator.clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => true)
    render(<ReportView report={report} lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeTruthy()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('asks the user to copy by hand when every copy path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => false)
    render(<ReportView report={report} lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(await screen.findByText(/Select the text below/)).toBeTruthy()
  })

  it('shares through the Web Share API when available', async () => {
    const share = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<ReportView report={report} lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: /Share/ }))
    expect(share).toHaveBeenCalledWith({ title: 'Incident report', text: 'Subject: complaint' })
    delete navigator.share
  })
})

describe('LivePanel', () => {
  const props = {
    lang: 'en', onLang: () => {}, active: true, lines: [], interim: '', alert: null, level: 0, elapsed: 3,
    callerNumber: '', status: ['monitoring', 'ok'], state: { score: 0, level: 0, stage: 0, tactics: [], hard_rule: '' },
  }

  it('explains why it cannot hear the call, and names the microphone', () => {
    render(<LivePanel {...props} hint="no_speech" device="Realtek Mic" />)
    expect(screen.getByRole('alert').textContent).toMatch(/second device/)
    expect(screen.getByText(/Realtek Mic/)).toBeTruthy()
  })

  it('shows no hint while the call is heard', () => {
    render(<LivePanel {...props} hint="" device="" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
