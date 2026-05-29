import { decorativeAssets, getDecorativeAssetStyle } from '../theme/backgroundTheme'

export default function DecorativeAsset({ assetKey, className = '' }) {
  const asset = decorativeAssets[assetKey] || decorativeAssets.homeHero

  return (
    <div
      className={`decorative-asset grid min-h-56 content-end rounded border border-yellow-200/20 p-5 shadow-2xl shadow-red-950/30 ${className}`}
      style={getDecorativeAssetStyle(assetKey)}
    >
      <div>
        <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">{asset.meta || 'Lucky Star'}</p>
        <h3 className="brand-title mt-2 text-2xl font-black">{asset.label}</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/66">{asset.caption}</p>
      </div>
    </div>
  )
}
