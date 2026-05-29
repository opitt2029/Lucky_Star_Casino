import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSelector } from 'react-redux'
import DecorativeAsset from '../components/DecorativeAsset'
import { gameCatalog, getBackgroundStyle } from '../theme/backgroundTheme'

const sections = [
  { id: 'intro', label: '介紹' },
  { id: 'games', label: '遊戲' },
  { id: 'member', label: '會員' },
  { id: 'shop', label: '商城' },
]

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max)

function HomeHeader({ scrolled, progress }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  return (
    <header
      className={[
        'fixed inset-x-0 top-0 z-40 border-b text-white backdrop-blur transition-all duration-500',
        scrolled ? 'scrolled-header border-yellow-200/30' : 'border-yellow-200/15 bg-red-950/70',
      ].join(' ')}
      style={{ '--scroll-progress': progress }}
    >
      <div className={['mx-auto flex max-w-7xl items-center justify-between px-4 transition-all duration-500 sm:px-6 lg:px-8', scrolled ? 'py-3' : 'py-5'].join(' ')}>
        <Link to="/" className="brand-title font-black tracking-tight">
          幸運星幣城
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded px-3 py-2 text-sm font-bold text-yellow-100/72 transition hover:bg-yellow-200 hover:text-red-950">
              {section.label}
            </a>
          ))}
          <Link
            to={isAuthenticated ? '/games' : '/member'}
            className="gold-button rounded px-4 py-2 text-sm font-black transition"
          >
            {isAuthenticated ? '進入遊戲大全' : '會員登入'}
          </Link>
        </nav>

        <div className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="red-gold-button grid h-10 w-10 place-items-center rounded"
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
            <div className="luxury-panel absolute right-0 top-12 w-56 rounded p-2 shadow-2xl">
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
              <Link
                to="/member"
                className="gold-button mt-2 block rounded px-3 py-2 text-sm font-black"
                onClick={() => setMenuOpen(false)}
              >
                會員登入 / 註冊
              </Link>
              {isAuthenticated && (
                <Link
                  to="/profile"
                  className="red-gold-button mt-2 block rounded px-3 py-2 text-sm font-black"
                  onClick={() => setMenuOpen(false)}
                >
                  會員中心
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
            (element.clientHeight * 0.92),
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
      className={['theme-background scroll-shell scroll-sections h-screen overflow-y-auto text-white', scrollState.scrolled ? 'is-scrolled' : ''].join(' ')}
      style={{
        ...getBackgroundStyle('home'),
        '--scroll-progress': scrollProgress,
        '--scroll-glow-opacity': (0.24 + scrollProgress * 0.34).toFixed(3),
        '--scroll-glow-y': `${(-32 * scrollProgress).toFixed(1)}px`,
        '--scroll-gold-x': `${(18 + scrollProgress * 56).toFixed(1)}%`,
        '--scroll-red-y': `${(20 + scrollProgress * 34).toFixed(1)}%`,
      }}
    >
      <HomeHeader scrolled={scrollState.scrolled} progress={scrollState.progress} />

      <section id="intro" className="scroll-section flex items-center px-4 pt-24 sm:px-6 lg:px-8">
        <div className="scroll-section-grid mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1fr_0.84fr]">
          <div className="scroll-copy">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Lucky Star Casino</p>
            <h1 className="brand-title mt-4 max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">幸運星幣城</h1>
            <p className="mt-6 max-w-2xl text-base font-bold leading-8 text-yellow-100/78">
              從首頁進入會員、遊戲大全與賭場商城。登入後即可選擇遊戲、累積籌碼，並在商城兌換禮品。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={isAuthenticated ? '/games' : '/member'} className="gold-button rounded px-6 py-3 text-sm font-black transition">
                {isAuthenticated ? '查看遊戲大全' : '登入後開始'}
              </Link>
              <a href="#games" className="red-gold-button rounded px-6 py-3 text-sm font-black transition">
                瀏覽網站結構
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
              <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Game Directory</p>
              <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">遊戲大全作為所有遊戲入口</h2>
              <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
                未登入使用者會先導向會員頁。登入後可從遊戲大全進入每個遊戲網頁，遊玩結果會更新籌碼。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {gameCatalog.map((game) => (
                <Link
                  key={game.id}
                  to={isAuthenticated ? game.to : '/member'}
                  className="luxury-panel-soft rounded p-5 transition hover:border-yellow-200/70 hover:bg-red-800/70"
                >
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.24em]">{game.meta}</p>
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
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Member Gate</p>
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">會員頁負責登入、註冊與遊戲門禁</h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              遊戲大全、遊戲網頁與賭場商城都需要登入。尚未登入時會導回會員頁，完成登入後再進入遊戲流程。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/member" className="gold-button rounded px-6 py-3 text-sm font-black transition">
                前往會員頁
              </Link>
              <Link to={isAuthenticated ? '/profile' : '/member'} className="red-gold-button rounded px-6 py-3 text-sm font-black transition">
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
            <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">賭場商城承接遊戲贏得的籌碼</h2>
            <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              商城頁已預留禮品素材與兌換流程，後續可以接上實際庫存、出貨狀態或活動 API。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={isAuthenticated ? '/shop' : '/member'} className="gold-button rounded px-6 py-3 text-sm font-black transition">
                進入賭場商城
              </Link>
              <Link to={isAuthenticated ? '/games' : '/member'} className="red-gold-button rounded px-6 py-3 text-sm font-black transition">
                先去贏籌碼
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
