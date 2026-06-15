import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { useSound } from '../casino-fx/sound/useSound'
import './QuickToolbar.css'

const tools = [
  {
    label: '每日簽到',
    path: '/check-in',
    protected: true,
    icon: (
      <path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 9 2 2 4-5" />
    ),
  },
  {
    label: '遊戲大廳',
    path: '/games',
    protected: true,
    icon: <path d="M6 12h12M12 6v12M7 17l-2 2M17 17l2 2M7 7 5 5M17 7l2-2" />,
  },
  {
    label: '捕魚機',
    path: '/game/fishing',
    protected: true,
    icon: <path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Zm9-2v.01M19 9l2-2v10l-2-2" />,
  },
  {
    label: '會員中心',
    path: '/profile',
    protected: true,
    icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0" />,
  },
  {
    label: '鑽石錢包',
    path: '/diamond',
    protected: true,
    icon: <path d="M12 3 4 9l8 12 8-12-8-6Zm0 0 3 6-3 12-3-12 3-6ZM4 9h16" />,
  },
  {
    label: '禮品商城',
    path: '/shop',
    protected: false,
    icon: <path d="M6 8h12l-1 11H7L6 8Zm2 0a4 4 0 0 1 8 0M9 13h.01M15 13h.01" />,
  },
]

function ToolbarIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="quick-toolbar__icon">
      {children}
    </svg>
  )
}

export default function QuickToolbar() {
  const navigate = useNavigate()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const [message, setMessage] = useState('')
  const { play, settings, toggleSfx, toggleBgm } = useSound()

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [message])

  const goToLogin = (path, withNotice = true) => {
    if (withNotice) {
      setMessage('登入後即可使用此功能')
    }
    navigate('/member?mode=login', { state: { from: { pathname: path } } })
  }

  const handleProtectedNavigate = (path, options = {}) => {
    if (!isAuthenticated) {
      goToLogin(path, options.notice !== false)
      return
    }
    navigate(path)
  }

  const handleToolClick = (tool) => {
    if (tool.protected) {
      handleProtectedNavigate(tool.path, { notice: tool.path !== '/profile' })
      return
    }
    navigate(tool.path)
  }

  const handleAiService = () => {
    setMessage('客服入口準備中，請稍後再試')
  }

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    document.querySelector('.scroll-shell')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <aside className="quick-toolbar" aria-label="快速工具欄">
        <div className="quick-toolbar__panel">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className="quick-toolbar__button"
              onClick={() => handleToolClick(tool)}
            >
              <ToolbarIcon>{tool.icon}</ToolbarIcon>
              <span>{tool.label}</span>
            </button>
          ))}

          <button
            type="button"
            className="quick-toolbar__button"
            onClick={() => {
              toggleSfx()
              play('click')
            }}
            aria-pressed={settings.sfxEnabled}
          >
            <ToolbarIcon>
              {settings.sfxEnabled ? (
                <path d="M4 10v4h4l5 4V6l-5 4H4Zm12-2c1.5 1 2 5 0 8m3-11c3 2.5 3.5 9 0 14" />
              ) : (
                <path d="M4 10v4h4l5 4V6l-5 4H4Zm12 0 5 5m0-5-5 5" />
              )}
            </ToolbarIcon>
            <span>{settings.sfxEnabled ? '音效開' : '音效關'}</span>
          </button>

          <button
            type="button"
            className="quick-toolbar__button"
            onClick={() => {
              toggleBgm()
              play('click')
            }}
            aria-pressed={settings.bgmEnabled}
          >
            <ToolbarIcon>
              {settings.bgmEnabled ? (
                <path d="M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 0V5l10-2v13m0 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
              ) : (
                <path d="M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 0V5l10-2v6M5 3l16 18" />
              )}
            </ToolbarIcon>
            <span>{settings.bgmEnabled ? '音樂開' : '音樂關'}</span>
          </button>

          <button type="button" className="quick-toolbar__button" onClick={handleAiService}>
            <ToolbarIcon>
              <path d="M5 11a7 7 0 0 1 14 0v5a3 3 0 0 1-3 3h-2M5 11v4a2 2 0 0 0 2 2h1v-6H5Zm14 0h-3v6h1a2 2 0 0 0 2-2v-4Z" />
            </ToolbarIcon>
            <span>客服</span>
          </button>

          <button
            type="button"
            className="quick-toolbar__button quick-toolbar__button--top"
            onClick={handleBackToTop}
          >
            <ToolbarIcon>
              <path d="M12 19V5M6 11l6-6 6 6" />
            </ToolbarIcon>
            <span>回頂端</span>
          </button>
        </div>
      </aside>

      {message && (
        <div className="quick-toolbar__notice-layer" role="status" aria-live="polite">
          <div className="quick-toolbar__notice-box">
            <p>{message}</p>
          </div>
        </div>
      )}
    </>
  )
}
