// 統一美術資源管理層 —— 全專案圖案唯一查表入口。
//
// 換圖流程（AI 精緻圖完成後）：
//   1. 圖檔放 frontend/public/art/{assetId}.png（透明背景、正方形）
//   2. 在下方 ART_OVERRIDES 加一行 'asset-id': '/art/asset-id.png'
//   其餘程式碼零修改；沒列 override 的 id 繼續用程式化 SVG fallback。
import {
  Angelfish,
  Caishen,
  Cannon,
  CannonCopper,
  CannonSilver,
  CopperCoin,
  DevilRay,
  DragonKing,
  FuChar,
  GoldDragonFish,
  GoldenDragon,
  Goldfish,
  GoldIngot,
  KoiFish,
  LanternFish,
  MoneyTree,
  Pixiu,
  PufferFish,
  RedEnvelope,
  SimpleCoin,
  StarCoin,
} from './svgArt'

// AI 圖替換表：assetId → public 路徑。預設空，逐步填入。
const ART_OVERRIDES = {
  'fishing-stage-background': '/images/fishing/fishing-stage-background-reference.png?v=20260707-reference',
  'cannon-copper': '/images/fishing/cannon-small-reference.png?v=20260707-reference-transparent',
  'cannon-silver': '/images/fishing/cannon-medium-reference.png?v=20260707-reference-transparent',
  cannon: '/images/fishing/cannon-heavy-reference.png?v=20260707-reference-transparent',
  'fish-koi': '/images/fishing/koi-reference.png?v=20260707-reference-transparent',
  'fish-goldfish': '/images/fishing/goldfish-reference.png?v=20260707-reference-transparent',
  'fish-lantern': '/images/fishing/lantern-reference.png?v=20260707-reference-transparent',
  'fish-puffer': '/images/fishing/puffer-reference.png?v=20260707-reference-transparent',
  'fish-angelfish': '/images/fishing/angelfish-reference.png?v=20260707-reference-transparent',
  'fish-devil-ray': '/images/fishing/devil-ray-reference.png?v=20260707-reference-transparent',
  'fish-gold-dragon': '/images/fishing/gold-dragon-reference.png?v=20260707-reference-transparent',
  'fish-pixiu': '/images/fishing/pixiu-gold-guardian.png?v=20260707-reference-transparent',
  'fish-caishen': '/images/fishing/caishen-reference.png?v=20260707-reference-transparent',
  'fish-dragon-king': '/images/fishing/gold-star-fish-king-reference.png?v=20260707-reference-transparent',
  'fish-golden-dragon-king': '/images/fishing/golden-dragon-king.svg?v=dragon-head-v2',
  'fish-jackpot-fish-king': '/images/fishing/jackpot-fish-king.svg?v=rainbow-front-smooth',
  'fish-rainbow-jackpot-fish-king': '/images/fishing/jackpot-fish-king-reference.png?v=20260707-reference-transparent',
  'fish-money-tree': '/images/fishing/money-tree-reference.png?v=20260707-reference-transparent',
  'fish-blocker-octopus': '/images/fishing/blocker-octopus-reference.png?v=20260707-paeth-fix',
  'fish-blocker-starfish': '/images/fishing/blocker-starfish-reference.png?v=20260707-paeth-fix',
  'fish-blocker-turtle': '/images/fishing/blocker-turtle-reference.png?v=20260707-paeth-fix',
  'fish-evil-blocker-octopus': '/images/fishing/blocker-octopus-reference.png?v=20260707-paeth-fix',
  'fish-evil-blocker-starfish': '/images/fishing/blocker-starfish-reference.png?v=20260707-paeth-fix',
  'fish-evil-blocker-turtle': '/images/fishing/blocker-turtle-reference.png?v=20260707-paeth-fix',
}
const SVG_COMPONENTS = {
  // 老虎機符號（華人財富意象）
  'slot-ingot': GoldIngot,
  'slot-copper-coin': CopperCoin,
  'slot-red-envelope': RedEnvelope,
  'slot-fu': FuChar,
  'slot-dragon': GoldenDragon,
  // 捕魚機魚種（id 與後端 FishSpecies 對齊，小寫-中線）
  'fish-koi': KoiFish,
  'fish-goldfish': Goldfish,
  'fish-lantern': LanternFish,
  'fish-puffer': PufferFish,
  'fish-angelfish': Angelfish,
  'fish-devil-ray': DevilRay,
  'fish-gold-dragon': GoldDragonFish,
  'fish-pixiu': Pixiu,
  'fish-caishen': Caishen,
  'fish-dragon-king': DragonKing,
  'fish-money-tree': MoneyTree,
  // 其他
  cannon: Cannon, // 金炮（L3）
  'cannon-copper': CannonCopper, // 銅炮（L1）
  'cannon-silver': CannonSilver, // 銀炮（L2）
  coin: SimpleCoin,
  'star-coin': StarCoin,
}

// 老虎機後端契約：grid 內容是 emoji 字串（SlotSymbol.java 的 display），
// 必須逐位元組一致才能對上（7️⃣ 是三個 code point）。這裡把 emoji 映射到華人意象素材。
export const SLOT_SYMBOL_ASSET = {
  '\u{1F352}': 'slot-ingot', // 🍒 → 金元寶（2x）
  '\u{1F34B}': 'slot-copper-coin', // 🍋 → 銅錢（3x）
  '\u{1F514}': 'slot-red-envelope', // 🔔 → 紅包（5x）
  '⭐': 'slot-fu', // ⭐ → 福字（8x）
  '7️⃣': 'slot-dragon', // 7️⃣ → 金龍（8x）
}

/**
 * 查資源。優先回傳 AI 圖 override，否則回程式化 SVG 元件。
 * @returns {{ type: 'image', url: string } | { type: 'svg', Component: Function } | null}
 */
export function getAsset(assetId) {
  const url = ART_OVERRIDES[assetId]
  if (url) return { type: 'image', url }
  const Component = SVG_COMPONENTS[assetId]
  if (Component) return { type: 'svg', Component }
  return null
}
