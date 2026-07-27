const iconStyles = {
  line: {
    bg: '#06c755',
    fg: '#ffffff',
  },
  google: {
    bg: '#ffffff',
    fg: '#1f2937',
  },
  apple: {
    bg: '#f4f4f5',
    fg: '#111827',
  },
}

export default function SocialProviderIcon({ provider = 'line', className = '' }) {
  const id = String(provider).toLowerCase()
  const style = iconStyles[id] || iconStyles.line

  if (id === 'google') {
    return (
      <svg viewBox="0 0 64 64" role="img" aria-label="Google" className={className}>
        <circle cx="32" cy="32" r="30" fill={style.bg} />
        <path fill="#4285f4" d="M54 32.6c0-1.6-.1-2.8-.4-4H32v8.1h12.7c-.3 2.1-1.7 5.1-4.9 7.2l-.1.6 7.1 5.5.5.1C51.6 46.1 54 40.1 54 32.6Z" />
        <path fill="#34a853" d="M32 55c6.2 0 11.4-2 15.2-5.4l-7.3-5.7c-2 1.3-4.6 2.2-7.9 2.2-6 0-11.1-4-12.9-9.4l-.5.1-7.4 5.7-.1.5C14.9 50.1 22.8 55 32 55Z" />
        <path fill="#fbbc05" d="M19.1 36.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-.1-.5-7.5-5.8-.5.2C9.1 24.5 8 28.1 8 32s1.1 7.5 3 10.8l8.1-6.1Z" />
        <path fill="#ea4335" d="M32 17.9c4.3 0 7.2 1.9 8.9 3.4l6.5-6.3C43.4 11.3 38.2 9 32 9c-9.2 0-17.1 4.9-21 12.2l8.1 6.1c1.8-5.4 6.9-9.4 12.9-9.4Z" />
      </svg>
    )
  }

  if (id === 'apple') {
    return (
      <svg viewBox="0 0 64 64" role="img" aria-label="Apple" className={className}>
        <circle cx="32" cy="32" r="30" fill={style.bg} />
        <path fill={style.fg} d="M40.7 33.8c0-4.4 3.6-6.6 3.8-6.7-2.1-3-5.3-3.4-6.4-3.5-2.7-.3-5.3 1.6-6.7 1.6s-3.5-1.6-5.8-1.5c-3 .1-5.8 1.8-7.3 4.5-3.1 5.4-.8 13.3 2.2 17.7 1.5 2.1 3.2 4.5 5.5 4.4 2.2-.1 3-1.4 5.7-1.4s3.4 1.4 5.8 1.4c2.4 0 3.9-2.2 5.3-4.3 1.7-2.5 2.4-4.8 2.4-5-.1-.1-4.5-1.8-4.5-7.2ZM36.4 20.7c1.2-1.5 2-3.5 1.8-5.5-1.7.1-3.8 1.1-5 2.6-1.1 1.3-2.1 3.4-1.8 5.4 1.9.2 3.8-1 5-2.5Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="LINE" className={className}>
      <circle cx="32" cy="32" r="30" fill={style.bg} />
      <path fill={style.fg} d="M50 30.8c0-8.5-8.1-15.4-18-15.4s-18 6.9-18 15.4c0 7.6 6.7 14 15.8 15.2.6.1 1.4.4 1.6.9.2.4.1 1.1.1 1.6l-.3 2.1c-.1.6-.5 2.3 1.6 1.3 2.1-1 11.3-6.6 15.4-11.3C49.4 37.8 50 34.5 50 30.8Z" />
      <path fill={style.bg} d="M23.2 35.7h-4.4V26h2v7.9h2.4v1.8Zm4.2 0h-2V26h2v9.7Zm8.4 0h-1.9l-3.9-5.9v5.9h-2V26h1.9l3.9 5.9V26h2v9.7Zm7.4-7.9h-3.3v2h3.1v1.8h-3.1v2.3h3.3v1.8h-5.3V26h5.3v1.8Z" />
    </svg>
  )
}
