import { useEffect, useId, useState } from 'react'

export default function GameRuleCard({ title, subtitle, rules, payouts = [] }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="luxury-panel group w-full rounded p-4 text-left transition hover:border-yellow-200/60 hover:brightness-110"
      >
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="gold-muted block text-xs font-black uppercase tracking-[0.25em]">
              Game Guide
            </span>
            <span className="brand-title mt-1 block text-xl font-black">遊戲規則</span>
          </span>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-yellow-200/40 bg-yellow-200/10 text-lg font-black text-yellow-100 transition group-hover:bg-yellow-200 group-hover:text-red-950">
            ?
          </span>
        </span>
        <span className="mt-3 block text-sm font-bold leading-6 text-yellow-100/66">
          {subtitle}
        </span>
      </button>

      {open && (
        <section
          className="fixed inset-0 z-50 grid place-items-center bg-red-950/74 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={() => setOpen(false)}
        >
          <div
            className="luxury-panel max-h-[calc(100vh-3rem)] w-full max-w-md overflow-auto rounded p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">
                  Rule Book
                </p>
                <h2 id={titleId} className="brand-title mt-1 text-2xl font-black">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="red-gold-button rounded px-3 py-2 text-xs font-black"
              >
                關閉
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              {rules.map((rule, index) => (
                <div
                  key={rule}
                  className="flex gap-3 rounded border border-yellow-200/15 bg-red-950/70 p-3"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-yellow-200 text-sm font-black text-red-950">
                    {index + 1}
                  </span>
                  <p className="text-sm font-bold leading-6 text-yellow-100/78">{rule}</p>
                </div>
              ))}
            </div>

            {payouts.length > 0 && (
              <div className="mt-4 rounded border border-yellow-200/15 bg-red-950/70 p-3">
                <p className="gold-muted text-xs font-black uppercase tracking-[0.2em]">
                  Payout
                </p>
                <div className="mt-3 grid gap-2">
                  {payouts.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-bold text-yellow-100/66">{item.label}</span>
                      <span className="font-black text-yellow-100">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
