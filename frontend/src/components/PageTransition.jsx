import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const TRANSITION_MS = 720

function shouldAnimateLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
    return false
  }

  if (!(event.target instanceof window.Element)) {
    return false
  }

  const anchor = event.target.closest('a[href]')

  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
    return false
  }

  const href = anchor.getAttribute('href')

  if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false
  }

  const targetUrl = new window.URL(anchor.href, window.location.href)

  return targetUrl.origin === window.location.origin
}

export default function PageTransition({ children }) {
  const location = useLocation()
  const timeoutRef = useRef(0)
  const frameRef = useRef(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [animationKey, setAnimationKey] = useState(0)

  const startTransition = useCallback(() => {
    window.clearTimeout(timeoutRef.current)
    window.cancelAnimationFrame(frameRef.current)
    setIsAnimating(false)

    frameRef.current = window.requestAnimationFrame(() => {
      setIsAnimating(true)
      timeoutRef.current = window.setTimeout(() => setIsAnimating(false), TRANSITION_MS)
    })
  }, [])

  useEffect(() => {
    startTransition()
    setAnimationKey((current) => current + 1)
  }, [location.pathname, startTransition])

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (shouldAnimateLink(event)) {
        startTransition()
      }
    }

    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
      window.clearTimeout(timeoutRef.current)
      window.cancelAnimationFrame(frameRef.current)
    }
  }, [startTransition])

  return (
    <>
      <div key={animationKey} className="page-transition-stage">
        {children}
      </div>
      <div className="page-transition-overlay" data-active={isAnimating || undefined} aria-hidden="true" />
    </>
  )
}
