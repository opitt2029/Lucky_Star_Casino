import { useEffect, useMemo, useState } from 'react'
import { getAvatarPresetForPlayer } from '../data/avatarPresets'

export default function RankPlayerAvatar({ player, size = 'md', className = '' }) {
  const nickname = player?.nickname || player?.name || player?.username || 'Player'
  const explicitAvatarUrl = player?.avatarUrl || player?.avatar || ''
  const presetAvatar = useMemo(() => getAvatarPresetForPlayer(player), [player])
  const fallbackAvatarUrl = player?.fallbackAvatarUrl || presetAvatar.src
  const [failedUrl, setFailedUrl] = useState('')

  useEffect(() => {
    setFailedUrl('')
  }, [explicitAvatarUrl, fallbackAvatarUrl])

  const useExplicitAvatar = explicitAvatarUrl && failedUrl !== explicitAvatarUrl
  const useFallbackAvatar = fallbackAvatarUrl && failedUrl !== fallbackAvatarUrl
  const avatarSrc = useExplicitAvatar ? explicitAvatarUrl : useFallbackAvatar ? fallbackAvatarUrl : ''
  const sizes = {
    sm: 'h-9 w-9 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-16 w-16 text-lg',
    xl: 'h-20 w-20 text-2xl',
  }

  return (
    <span
      className={[
        'grid shrink-0 place-items-center overflow-hidden rounded-full border border-yellow-200/35 bg-red-950/80 font-black text-yellow-100 shadow-[0_0_22px_rgba(248,200,76,0.18)]',
        sizes[size] || sizes.md,
        className,
      ].join(' ')}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={`${nickname} avatar`}
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(avatarSrc)}
        />
      ) : (
        nickname.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}