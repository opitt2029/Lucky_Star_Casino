import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FishingControlDock from './FishingControlDock'
import { FISHING_AMMO_OPTIONS } from '../data/fishingConfig'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

function renderDock(props = {}) {
  const activeAmmo = props.activeAmmo || FISHING_AMMO_OPTIONS[1]
  root = createRoot(container)
  act(() => {
    root.render(
      <FishingControlDock
        activeAmmo={activeAmmo}
        ammoOptions={FISHING_AMMO_OPTIONS}
        cannonLevel={activeAmmo.level}
        ammoTone={activeAmmo.tone}
        canSettle
        disabledReason=""
        isSettling={false}
        isAmmoLocked
        onSettle={vi.fn()}
        {...props}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) {
    act(() => root.unmount())
  }
  root = null
  container.remove()
  vi.clearAllMocks()
})

describe('FishingControlDock', () => {
  test('遊戲中顯示本局彈藥、每發金額、砲台等級與收網按鈕', () => {
    renderDock()

    expect(container.textContent).toContain('本局彈藥：普通彈藥')
    expect(container.textContent).toContain('本局彈藥金額：50 / 發')
    expect(container.textContent).toContain('每發金額 50')
    expect(container.textContent).toContain('Lv 2')
    expect(container.textContent).toContain('收網')
  })

  test('目前彈藥按鈕會同步 aria-pressed 與 is-active class', () => {
    renderDock()

    const ammoButtons = Array.from(container.querySelectorAll('.fishing-dock-ammo'))
    const activeButtons = ammoButtons.filter((button) => button.classList.contains('is-active'))

    expect(activeButtons).toHaveLength(1)
    expect(activeButtons[0].getAttribute('aria-pressed')).toBe('true')
    expect(activeButtons[0].textContent).toContain('普通彈藥')
  })

  test('activeAmmo 優先於 cannonLevel，避免錯亮多個彈藥按鈕', () => {
    renderDock({ activeAmmo: FISHING_AMMO_OPTIONS[2], cannonLevel: 1 })

    const ammoButtons = Array.from(container.querySelectorAll('.fishing-dock-ammo'))
    const activeButtons = ammoButtons.filter((button) => button.classList.contains('is-active'))

    expect(activeButtons).toHaveLength(1)
    expect(activeButtons[0].getAttribute('aria-pressed')).toBe('true')
    expect(activeButtons[0].textContent).toContain('重型彈藥')
  })

  test('場次開始後彈藥按鈕鎖定，不呼叫彈藥切換 callback', () => {
    const onAmmoSelect = vi.fn()
    renderDock({ onAmmoSelect })

    const ammoButtons = Array.from(container.querySelectorAll('.fishing-dock-ammo'))
    expect(ammoButtons).toHaveLength(3)

    for (const button of ammoButtons) {
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.title).toContain('完成收網結算後可重新選擇')
      button.click()
    }

    expect(onAmmoSelect).not.toHaveBeenCalled()
  })

  test('遊戲中不再出現可切換或下一發生效文案', () => {
    renderDock()

    expect(container.textContent).not.toContain('遊戲中可切換彈藥')
    expect(container.textContent).not.toContain('切換後下一發生效')
    expect(container.textContent).not.toContain('目前彈藥會影響下一發子彈')
  })

  test('收網按鈕仍可觸發結算操作', () => {
    const onSettle = vi.fn()
    renderDock({ onSettle })

    const settleButton = container.querySelector('.fishing-stage-settle')
    expect(settleButton.disabled).toBe(false)

    act(() => {
      settleButton.click()
    })

    expect(onSettle).toHaveBeenCalledTimes(1)
  })
})