import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import App from './App'
import './index.css'

const preventBrowserZoom = (event: Event) => event.preventDefault()

document.addEventListener('gesturestart', preventBrowserZoom, { passive: false })
document.addEventListener('gesturechange', preventBrowserZoom, { passive: false })
document.addEventListener(
  'touchmove',
  (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  },
  { passive: false },
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
