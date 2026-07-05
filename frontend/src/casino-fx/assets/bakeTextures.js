// 程式化 SVG 美術 → PIXI.Texture 烘焙快取。
//
// 為什麼：Pixi 漁場（FishingCanvas）需要紋理，而 casino-fx 的美術是 React SVG 元件
// （svgArt.jsx，viewBox 0 0 100 100、自帶 useId）。這裡在啟動時把這些元件「離屏 rasterize」
// 成 Texture 並快取，第一幀就有圖；PNG override（registry 的 ART_OVERRIDES）走 Assets.load，
// 維持「換 AI 精緻圖零改碼」（見 registry.js 註解）。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Assets, Texture } from 'pixi.js'
import { getAsset } from './registry'

// key: `${assetId}@${px}` → Promise<Texture>。app 卸載時 clearCache()，避免重掛載拿到舊 GPU 資源。
const cache = new Map()

function svgToDataUrl(svgString) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
}

// 把 SVG 元件渲染成字串 → data URL → Image → Texture。
async function bakeSvg(Component, px) {
  // 元件本身是 <svg viewBox="0 0 100 100">；補上像素尺寸與 xmlns 讓 Image 有 intrinsic size 可解碼。
  const markup = renderToStaticMarkup(
    createElement(Component, { width: px, height: px, xmlns: 'http://www.w3.org/2000/svg' }),
  )
  const img = new window.Image(px, px)
  img.src = svgToDataUrl(markup)
  await img.decode()
  return Texture.from(img)
}

/**
 * 取得（並快取）某 assetId 的 Texture。
 * @param {string} assetId registry 的圖案 id（如 'fish-koi'、'cannon'）
 * @param {number} px 烘焙解析度（正方形邊長）
 * @returns {Promise<Texture>}
 */
export function getTexture(assetId, px = 256) {
  const asset = getAsset(assetId)
  const sourceKey = asset?.type === 'image' ? asset.url : asset?.Component?.name || 'missing'
  const key = `${assetId}@${px}@${sourceKey}`
  if (cache.has(key)) return cache.get(key)
  let promise
  if (!asset) {
    promise = Promise.resolve(Texture.WHITE) // 缺圖退化為白塊，不讓引擎崩潰
  } else if (asset.type === 'image') {
    promise = Assets.load(asset.url) // PNG override
  } else {
    promise = bakeSvg(asset.Component, px)
  }
  cache.set(key, promise)
  return promise
}

/**
 * 批次預烘焙，回傳 { assetId: Texture } 解析後的查表，給引擎同步取用。
 */
export async function preload(assetIds, px = 256) {
  const entries = await Promise.all(
    assetIds.map(async (id) => {
      const tex = await getTexture(id, px).catch(() => Texture.WHITE)
      return [id, tex]
    }),
  )
  return Object.fromEntries(entries)
}

// app/engine 卸載時清快取：下次重掛載會在新的 renderer 上重新烘焙，避免共用到被銷毀的紋理。
export function clearCache() {
  cache.clear()
}
