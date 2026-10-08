import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// Poppins is bundled with the app (no Google Fonts request: works offline and leaks no IP).
// Each weight's CSS uses unicode-range, so only the Latin / Devanagari files a page needs load.
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
