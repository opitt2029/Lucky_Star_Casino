import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSelector } from 'react-redux'
import DecorativeAsset from '../components/DecorativeAsset'
import CoinRain from '../components/CoinRain'
import { gameCatalog, getBackgroundStyle } from '../theme/backgroundTheme'
import { gameApi } from '../services/gameApi'

const sections = [
  { id: 'intro', label: '介紹' },
  { id: 'games', label: '遊戲' },
  { id: 'member', label: '會員' },
  { id: 'shop', label: '商城' },
]

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max)
const PROFILE_GAME_FETCH_CAP = 200
const GAME_PLAY_ESTIMATES_MS = {
  SLOT: 30 * 1000,
  BACCARAT: 45 * 1000,
  FISHING: 3 * 60 * 1000,
}

function roundDurationMs(row) {
  const fallback = GAME_PLAY_ESTIMATES_MS[row?.gameType] || 60 * 1000
  const start = Date.parse(row?.betAt || row?.createdAt || row?.settledAt || '')
  const end = Date.parse(row?.settledAt || row?.updatedAt || row?.betAt || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback
  return Math.max(fallback, end - start)
}

function formatDuration(ms) {
  if (!ms) return '0 分鐘'
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`
}

function memberDisplayName(player) {
  return player?.nickname || player?.username || '會員中心'
}

function UserProfileChip({ player, onClick, expanded = false }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const memberLabel = memberDisplayName(player)
  const fallbackInitial = memberLabel.slice(0, 1).toUpperCase()
  const canShowAvatar = player?.avatarUrl && !avatarFailed

  return (
    <button
      type="button"
      onClick={onClick}
      className="luxury-panel-soft flex max-w-[220px] shrink-0 items-center gap-2 rounded px-3 py-2 text-left transition hover:border-yellow-200/50 focus:outline-none focus:ring-2 focus:ring-yellow-200/70"
      aria-label={`開啟 ${memberLabel} 的會員資訊`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-yellow-200/30 bg-red-950/80 text-sm font-black text-yellow-100">
        {canShowAvatar ? (
          <img
            src={player.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          fallbackInitial
        )}
      </span>
      <span className="min-w-0">
        <span className="gold-muted block text-[10px] font-black uppercase">Member</span>
        <span className="block truncate text-sm font-black text-yellow-100">{memberLabel}</span>
      </span>
    </button>
  )
}

function ProfileInfoPopover({ player, totalPlayMs, loading, error, onClose }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const memberLabel = memberDisplayName(player)
  const fallbackInitial = memberLabel.slice(0, 1).toUpperCase()
  const canShowAvatar = player?.avatarUrl && !avatarFailed

  return (
    <div
      className="luxury-panel absolute right-0 top-14 z-50 w-80 max-w-[calc(100vw-2rem)] rounded p-4 shadow-2xl"
      role="dialog"
      aria-label="會員基本資訊"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-yellow-200/40 bg-red-950/80 text-base font-black text-yellow-100">
            {canShowAvatar ? (
              <img
                src={player.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              fallbackInitial
            )}
          </span>
          <div className="min-w-0">
            <p className="gold-muted text-[10px] font-black uppercase tracking-[0.22em]">
              Member Info
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-yellow-100">{memberLabel}</h2>
            {player?.username && (
              <p className="mt-0.5 truncate text-xs font-bold text-yellow-100/58">
                @{player.username}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded border border-yellow-200/20 bg-red-950/70 text-yellow-100 transition hover:border-yellow-200/70 hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-yellow-200/70"
          aria-label="關閉會員資訊"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded border border-yellow-200/15 bg-red-950/65 px-3 py-2">
          <span className="block text-xs font-black text-yellow-100/45">遊戲時數</span>
          <strong className="mt-1 block text-yellow-100">
            {loading ? '統計中...' : error ? '暫無資料' : formatDuration(totalPlayMs)}
          </strong>
        </div>
        <div className="rounded border border-yellow-200/15 bg-red-950/65 px-3 py-2">
          <span className="block text-xs font-black text-yellow-100/45">會員 ID</span>
          <strong className="mt-1 block truncate text-yellow-100">{player?.id || '-'}</strong>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
          遊戲時數暫時無法載入。
        </p>
      )}

      <Link
        to="/profile"
        onClick={onClose}
        className="gold-button mt-4 flex items-center justify-center rounded px-4 py-3 text-sm font-black transition"
      >
        前往會員中心
      </Link>
    </div>
  )
}

function GuestProfileChip({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="luxury-panel-soft flex max-w-[220px] shrink-0 items-center gap-2 rounded px-3 py-2 text-left transition hover:border-red-300/70"
      aria-label="尚未登入，點擊查看登入提示"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-red-300/40 bg-red-950/80 text-sm font-black text-red-200">
        ?
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase text-red-200/70">Visitor</span>
        <span className="block truncate text-sm font-black text-red-100">未登入</span>
      </span>
    </button>
  )
}

function HomeHeader({ scrolled, progress }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [guestNoticeOpen, setGuestNoticeOpen] = useState(false)
  const [profileInfoOpen, setProfileInfoOpen] = useState(false)
  const [profilePlaySummary, setProfilePlaySummary] = useState({
    totalMs: 0,
    loading: false,
    error: '',
  })
  const { isAuthenticated, player } = useSelector((state) => state.auth)

  useEffect(() => {
    if (isAuthenticated) {
      setGuestNoticeOpen(false)
      return
    }
    setProfileInfoOpen(false)
  }, [isAuthenticated])

  useEffect(() => {
    if (!profileInfoOpen) return undefined

    const handlePointerDown = (event) => {
      if (!event.target.closest('[data-profile-info-root]')) {
        setProfileInfoOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setProfileInfoOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [profileInfoOpen])

  useEffect(() => {
    if (!profileInfoOpen || !isAuthenticated || !player?.id) return undefined
    let active = true
    setProfilePlaySummary((current) => ({ ...current, loading: true, error: '' }))
    gameApi
      .gameHistory({ gameType: 'all', page: 1, pageSize: PROFILE_GAME_FETCH_CAP })
      .then((res) => {
        if (!active) return
        const rows = res?.items || []
        const totalMs = rows.reduce((sum, row) => sum + roundDurationMs(row), 0)
        setProfilePlaySummary({ totalMs, loading: false, error: '' })
      })
      .catch(() => {
        if (active)
          setProfilePlaySummary({ totalMs: 0, loading: false, error: '遊戲時數暫時無法載入' })
      })
    return () => {
      active = false
    }
  }, [profileInfoOpen, isAuthenticated, player?.id])

  return (
    <header
      className={[
        'fixed inset-x-0 top-0 z-40 border-b text-white backdrop-blur transition-all duration-500',
        scrolled ? 'scrolled-header border-yellow-200/30' : 'border-yellow-200/15 bg-red-950/70',
      ].join(' ')}
      style={{ '--scroll-progress': progress }}
    >
      <div
        className={[
          'mx-auto flex max-w-7xl items-center justify-between px-4 transition-all duration-500 sm:px-6 lg:px-8',
          scrolled ? 'py-3' : 'py-5',
        ].join(' ')}
      >
        <Link to="/" className="brand-title font-black tracking-tight">
          幸運星幣城
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded px-3 py-2 text-sm font-bold text-yellow-100/72 transition hover:bg-yellow-200 hover:text-red-950"
            >
              {section.label}
            </a>
          ))}
          <Link
            to={isAuthenticated ? '/games' : '/member'}
            className="gold-button rounded px-4 py-2 text-sm font-black transition"
          >
            {isAuthenticated ? '進入遊戲大全' : '會員登入'}
          </Link>
          {isAuthenticated ? (
            <div className="relative shrink-0" data-profile-info-root>
              <UserProfileChip
                player={player}
                expanded={profileInfoOpen}
                onClick={() => setProfileInfoOpen((open) => !open)}
              />
              {profileInfoOpen && (
                <ProfileInfoPopover
                  player={player}
                  totalPlayMs={profilePlaySummary.totalMs}
                  loading={profilePlaySummary.loading}
                  error={profilePlaySummary.error}
                  onClose={() => setProfileInfoOpen(false)}
                />
              )}
            </div>
          ) : (
            <>
              <GuestProfileChip onClick={() => setGuestNoticeOpen(true)} />
              {guestNoticeOpen && (
                <span className="shrink-0 text-xs font-black text-red-300">登入後即可使用</span>
              )}
            </>
          )}
        </nav>

        <div className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="red-gold-button grid h-11 w-11 place-items-center rounded"
            aria-label="開啟會員選單"
            aria-expanded={menuOpen}
          >
            <span className="grid gap-1">
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
            </span>
          </button>

          {menuOpen && (
            <div className="luxury-panel absolute right-0 top-14 w-56 max-w-[calc(100vw-2rem)] rounded p-2 shadow-2xl">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded px-3 py-2 text-sm font-bold text-yellow-100/72 hover:bg-yellow-200 hover:text-red-950"
                >
                  {section.label}
                </a>
              ))}
              {isAuthenticated ? (
                <div className="relative">
                  <UserProfileChip
                    player={player}
                    expanded={profileInfoOpen}
                    onClick={() => setProfileInfoOpen((open) => !open)}
                  />
                  {profileInfoOpen && (
                    <ProfileInfoPopover
                      player={player}
                      totalPlayMs={profilePlaySummary.totalMs}
                      loading={profilePlaySummary.loading}
                      error={profilePlaySummary.error}
                      onClose={() => setProfileInfoOpen(false)}
                    />
                  )}
                </div>
              ) : (
                <>
                  <GuestProfileChip onClick={() => setGuestNoticeOpen(true)} />
                  {guestNoticeOpen && (
                    <p className="mt-2 rounded px-3 py-2 text-sm font-black text-red-300">
                      登入後即可使用會員功能
                    </p>
                  )}
                </>
              )}
              {isAuthenticated ? (
                <Link
                  to="/profile"
                  className="red-gold-button mt-2 block rounded px-3 py-2 text-sm font-black"
                  onClick={() => setMenuOpen(false)}
                >
                  會員中心
                </Link>
              ) : (
                <Link
                  to="/member"
                  className="gold-button mt-2 block rounded px-3 py-2 text-sm font-black"
                  onClick={() => setMenuOpen(false)}
                >
                  會員登入 / 註冊
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default function Home() {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const scrollRef = useRef(null)
  const [scrollState, setScrollState] = useState({ scrolled: false, progress: 0 })
  const scrollProgress = scrollState.progress

  useEffect(() => {
    const element = scrollRef.current

    if (!element) {
      return undefined
    }

    let frameId = 0
    const updateScrollState = () => {
      const maxScroll = element.scrollHeight - element.clientHeight
      const progress = maxScroll > 0 ? element.scrollTop / maxScroll : 0
      const viewportCenter = element.scrollTop + element.clientHeight / 2
      const sectionNodes = element.querySelectorAll('.scroll-section')

      sectionNodes.forEach((section) => {
        const sectionCenter = section.offsetTop + section.offsetHeight / 2
        const centerDistance = (sectionCenter - viewportCenter) / element.clientHeight
        const visibility = clamp(1 - Math.abs(centerDistance) * 1.25)
        const revealProgress = clamp(
          (element.scrollTop - section.offsetTop + element.clientHeight * 0.84) /
            (element.clientHeight * 0.92)
        )
        const parallax = clamp(centerDistance, -1, 1)
        const copyOffset = (1 - revealProgress) * 34 + parallax * -14
        const visualOffset = parallax * -52
        const sectionLift = (1 - visibility) * 22
        const sectionScale = 0.965 + visibility * 0.035
        const glowOpacity = 0.16 + visibility * 0.38
        const sectionOpacity = 0.5 + visibility * 0.5
        const sectionBlur = (1 - visibility) * 4.5

        section.style.setProperty('--section-visibility', visibility.toFixed(3))
        section.style.setProperty('--section-reveal', revealProgress.toFixed(3))
        section.style.setProperty('--section-parallax', parallax.toFixed(3))
        section.style.setProperty('--section-copy-offset', `${copyOffset.toFixed(1)}px`)
        section.style.setProperty('--section-visual-offset', `${visualOffset.toFixed(1)}px`)
        section.style.setProperty('--section-lift', `${sectionLift.toFixed(1)}px`)
        section.style.setProperty('--section-scale', sectionScale.toFixed(3))
        section.style.setProperty('--section-glow-opacity', glowOpacity.toFixed(3))
        section.style.setProperty('--section-opacity', sectionOpacity.toFixed(3))
        section.style.setProperty('--section-blur', `${sectionBlur.toFixed(2)}px`)
        section.toggleAttribute('data-active', visibility > 0.72)
      })

      setScrollState({
        scrolled: element.scrollTop > 24,
        progress: Number(progress.toFixed(3)),
      })
    }

    const handleScroll = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(updateScrollState)
    }

    updateScrollState()
    element.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.cancelAnimationFrame(frameId)
      element.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    <div
      ref={scrollRef}
      className={[
        'theme-background scroll-shell scroll-sections h-screen overflow-y-auto text-white',
        scrollState.scrolled ? 'is-scrolled' : '',
      ].join(' ')}
      style={{
        ...getBackgroundStyle('home'),
        '--scroll-progress': scrollProgress,
        '--scroll-glow-opacity': (0.24 + scrollProgress * 0.34).toFixed(3),
        '--scroll-glow-y': `${(-32 * scrollProgress).toFixed(1)}px`,
        '--scroll-gold-x': `${(18 + scrollProgress * 56).toFixed(1)}%`,
        '--scroll-red-y': `${(20 + scrollProgress * 34).toFixed(1)}%`,
      }}
    >
      <CoinRain />
      <HomeHeader scrolled={scrollState.scrolled} progress={scrollState.progress} />

      <section id="intro" className="scroll-section flex items-center px-4 pt-24 sm:px-6 lg:px-8">
        <div className="scroll-section-grid mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1fr_0.84fr]">
          <div className="scroll-copy">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">
              Lucky Star Casino
            </p>
            <h1 className="brand-title mt-4 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">
              幸運星幣城
            </h1>
            <p className="mt-6 max-w-2xl text-base font-bold leading-8 text-yellow-100/78">
              使用模擬星幣體驗老虎機與百家樂，登入後可管理會員資料、兌換鑽石與查看遊戲紀錄。禮品商城可先瀏覽，確認喜歡的獎品再兌換。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={isAuthenticated ? '/games' : '/member'}
                className="gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                {isAuthenticated ? '查看遊戲大全' : '登入後開始'}
              </Link>
              <a
                href="#games"
                className="red-gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                先看有哪些遊戲
              </a>
            </div>
          </div>
          <DecorativeAsset assetKey="homeHero" className="scroll-visual min-h-[420px]" />
        </div>
      </section>

      <section id="games" className="scroll-section flex items-center px-4 py-24 sm:px-6 lg:px-8">
        <div className="scroll-section-grid mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.72fr_1fr]">
          <DecorativeAsset assetKey="homeGames" className="scroll-visual min-h-[360px]" />
          <div className="scroll-copy grid content-center gap-5">
            <div>
              <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">
                Game Lobby
              </p>
              <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                從遊戲大廳挑一局開始
              </h2>
              <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
                目前提供老虎機與百家樂。每局都會用星幣下注，結算結果會直接反映在你的星幣餘額。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {gameCatalog.map((game) => (
                <Link
                  key={game.id}
                  to={isAuthenticated ? game.to : '/member'}
                  className="luxury-panel-soft rounded p-5 transition hover:border-yellow-200/70 hover:bg-red-800/70"
                >
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.24em]">
                    {game.meta}
                  </p>
                  <h3 className="mt-3 text-2xl font-black">{game.title}</h3>
                  <p className="mt-2 text-sm font-bold text-yellow-100/62">{game.caption}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="member" className="scroll-section flex items-center px-4 py-24 sm:px-6 lg:px-8">
        <div className="scroll-section-grid mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1fr_0.72fr]">
          <div className="scroll-copy">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">
              Member Access
            </p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              登入後開始完整體驗
            </h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              建立帳號或登入後，就能進入遊戲、使用鑽石錢包、查看會員中心與好友狀態。尚未登入時，我們會帶你先完成登入。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/member"
                className="gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                登入或註冊
              </Link>
              <Link
                to={isAuthenticated ? '/profile' : '/member'}
                className="red-gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                會員中心
              </Link>
            </div>
          </div>
          <DecorativeAsset assetKey="memberHero" className="scroll-visual min-h-[360px]" />
        </div>
      </section>

      <section id="shop" className="scroll-section flex items-center px-4 py-24 sm:px-6 lg:px-8">
        <div className="scroll-section-grid mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[0.72fr_1fr]">
          <DecorativeAsset assetKey="shopHero" className="scroll-visual min-h-[360px]" />
          <div className="scroll-copy">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Casino Shop</p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              用鑽石換星幣，再兌換禮品
            </h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              輸入序號可取得鑽石，鑽石能依固定比例換成星幣；星幣可用於遊戲下注，也能在禮品商城兌換目前提供的獎品。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={isAuthenticated ? '/diamond' : '/member'}
                className="gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                進入鑽石錢包
              </Link>
              <Link
                to="/shop"
                className="red-gold-button rounded px-6 py-3 text-sm font-black transition"
              >
                瀏覽禮品商城
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
