// Appearance: 'system' follows prefers-color-scheme; 'light' / 'dark' force it via
// <html data-theme>, which styles.css reads.
export const THEMES = ['system', 'light', 'dark']

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
  else delete root.dataset.theme
}
