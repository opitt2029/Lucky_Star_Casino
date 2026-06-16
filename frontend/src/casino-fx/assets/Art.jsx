import { getAsset } from './registry'

// 統一圖案渲染元件：<Art id="fish-pixiu" className="h-10 w-10" />
// 自動依 registry 決定渲染 AI 圖（img）或程式化 SVG fallback。
export default function Art({ id, className, alt = '', ...rest }) {
  const asset = getAsset(id)
  if (!asset) return null
  if (asset.type === 'image') {
    return <img src={asset.url} alt={alt} className={className} draggable={false} {...rest} />
  }
  const { Component } = asset
  return <Component className={className} aria-hidden={alt === ''} {...rest} />
}
