export const BACKGROUND_ASSET_FOLDER = '/backgrounds/'

const asset = (fileName) => {
  if (!fileName) {
    return 'none'
  }

  return `url("${BACKGROUND_ASSET_FOLDER}${fileName}")`
}

export const gameCatalog = [
  {
    id: 'slot',
    to: '/game/slot',
    title: '老虎機',
    caption: '3x3 轉輪 / 100 起注',
    meta: '快速局',
    assetKey: 'slotGame',
  },
  {
    id: 'baccarat',
    to: '/game/baccarat',
    title: '百家樂',
    caption: '莊 / 閒 / 和 三區下注',
    meta: '牌桌局',
    assetKey: 'baccaratGame',
  },
]

export const shopCatalog = [
  {
    id: 'vip-ticket',
    title: 'VIP 入場券',
    caption: '預留給活動、抽獎或限時桌台資格',
    cost: 12000,
    assetKey: 'shopPrizeA',
  },
  {
    id: 'avatar-frame',
    title: '會員頭像框',
    caption: '可接會員中心外觀裝飾',
    cost: 8000,
    assetKey: 'shopPrizeB',
  },
  {
    id: 'bonus-box',
    title: '幸運禮盒',
    caption: '預留給兌換碼、道具或實體禮品',
    cost: 20000,
    assetKey: 'shopPrizeC',
  },
]

export const decorativeAssets = {
  homeHero: {
    image: 'casino-city-hero.png',
    meta: 'Neon Boulevard',
    label: '霓虹賭城入口',
    caption: '金色燈海、紅毯大道與高級賭場門面，作為幸運星幣城的主視覺。',
    overlay:
      'linear-gradient(90deg, rgba(32, 1, 5, 0.72) 0%, rgba(92, 5, 12, 0.3) 46%, rgba(8, 1, 3, 0.76) 100%), radial-gradient(circle at 82% 18%, rgba(255, 230, 148, 0.12), transparent 34%)',
  },
  homeGames: {
    image: 'casino-game-hall.png',
    meta: 'Game Hall',
    label: '豪華遊戲大廳',
    caption: '老虎機、牌桌與水晶吊燈構成明亮的遊戲入口氛圍。',
    overlay:
      'linear-gradient(135deg, rgba(72, 3, 8, 0.56) 0%, rgba(12, 1, 3, 0.78) 100%), radial-gradient(circle at 18% 20%, rgba(248, 213, 106, 0.12), transparent 32%)',
  },
  memberHero: {
    image: 'casino-city-hero.png',
    meta: 'Member Gate',
    label: '尊榮會員入口',
    caption: '從賭城門面進入會員中心，登入後開啟遊戲與商城權限。',
    overlay:
      'linear-gradient(180deg, rgba(64, 3, 8, 0.48) 0%, rgba(12, 1, 3, 0.82) 100%), radial-gradient(circle at 70% 16%, rgba(255, 234, 160, 0.14), transparent 30%)',
  },
  gamesGallery: {
    image: 'casino-game-hall.png',
    meta: 'Game Directory',
    label: '遊戲大全視覺',
    caption: '把遊戲機台與牌桌整合成明確的遊戲瀏覽入口。',
    overlay:
      'linear-gradient(135deg, rgba(70, 3, 8, 0.5) 0%, rgba(10, 1, 3, 0.82) 100%), radial-gradient(circle at 78% 24%, rgba(248, 213, 106, 0.12), transparent 32%)',
  },
  slotGame: {
    image: 'casino-game-hall.png',
    meta: 'Slot Game',
    label: '老虎機燈海',
    caption: '金色燈光與轉輪機台強化快速局的刺激感。',
    overlay:
      'linear-gradient(135deg, rgba(188, 11, 21, 0.2) 0%, rgba(12, 1, 3, 0.8) 100%), radial-gradient(circle at 22% 18%, rgba(255, 234, 160, 0.12), transparent 28%)',
  },
  baccaratGame: {
    image: 'casino-game-hall.png',
    meta: 'Baccarat',
    label: '百家樂牌桌',
    caption: '紅色牌桌與金色籌碼呈現經典賭場桌局。',
    overlay:
      'linear-gradient(135deg, rgba(132, 7, 14, 0.26) 0%, rgba(12, 1, 3, 0.8) 100%), radial-gradient(circle at 76% 18%, rgba(248, 213, 106, 0.12), transparent 30%)',
  },
  shopHero: {
    image: 'casino-rewards-showcase.png',
    meta: 'Reward Shop',
    label: '賭場獎品櫃',
    caption: '禮盒、籌碼與會員卡呈現商城兌換的獎勵期待感。',
    overlay:
      'linear-gradient(90deg, rgba(20, 1, 4, 0.72) 0%, rgba(110, 6, 13, 0.22) 58%, rgba(12, 1, 3, 0.78) 100%), radial-gradient(circle at 72% 24%, rgba(255, 234, 160, 0.14), transparent 34%)',
  },
  shopPrizeA: {
    image: 'casino-rewards-showcase.png',
    meta: 'VIP Reward',
    label: 'VIP 入場券',
    caption: '兌換限時活動與尊榮桌台資格。',
    overlay:
      'linear-gradient(135deg, rgba(255, 214, 86, 0.14) 0%, rgba(24, 1, 4, 0.78) 100%)',
  },
  shopPrizeB: {
    image: 'casino-rewards-showcase.png',
    meta: 'Avatar Reward',
    label: '會員頭像框',
    caption: '替會員中心增加更亮眼的個人識別。',
    overlay:
      'linear-gradient(135deg, rgba(248, 213, 106, 0.12) 0%, rgba(28, 1, 5, 0.78) 100%)',
  },
  shopPrizeC: {
    image: 'casino-rewards-showcase.png',
    meta: 'Lucky Box',
    label: '幸運禮盒',
    caption: '承接活動兌換、抽獎與稀有獎勵。',
    overlay:
      'linear-gradient(135deg, rgba(201, 13, 24, 0.18) 0%, rgba(18, 1, 4, 0.78) 100%), radial-gradient(circle at 76% 22%, rgba(255, 234, 160, 0.12), transparent 28%)',
  },
}

export const backgroundTheme = {
  app: {
    color: '#160103',
    image: 'casino-city-hero.png',
    overlay:
      'linear-gradient(180deg, rgba(28, 1, 4, 0.9) 0%, rgba(88, 4, 10, 0.74) 42%, rgba(8, 1, 3, 0.96) 100%)',
    accent:
      'radial-gradient(circle at 18% 12%, rgba(255, 234, 160, 0.22), transparent 30%), radial-gradient(circle at 82% 0%, rgba(201, 13, 24, 0.32), transparent 28%)',
    position: 'center',
    size: 'cover',
  },
  auth: {
    color: '#170103',
    image: 'casino-city-hero.png',
    overlay:
      'linear-gradient(135deg, rgba(51, 2, 6, 0.94) 0%, rgba(114, 6, 13, 0.72) 48%, rgba(14, 1, 3, 0.96) 100%)',
    accent:
      'radial-gradient(circle at 14% 18%, rgba(255, 234, 160, 0.24), transparent 28%), radial-gradient(circle at 78% 86%, rgba(201, 13, 24, 0.28), transparent 32%)',
    position: 'center',
    size: 'cover',
  },
  authHero: {
    color: '#180103',
    image: 'casino-city-hero.png',
    overlay:
      'linear-gradient(180deg, rgba(108, 6, 13, 0.54) 0%, rgba(18, 1, 4, 0.9) 100%)',
    accent:
      'radial-gradient(circle at 24% 20%, rgba(255, 234, 160, 0.28), transparent 30%), radial-gradient(circle at 78% 66%, rgba(201, 13, 24, 0.28), transparent 34%)',
    position: 'center',
    size: 'cover',
  },
  lobbyHero: {
    color: '#170103',
    image: 'casino-game-hall.png',
    overlay:
      'linear-gradient(90deg, rgba(55, 2, 7, 0.9) 0%, rgba(133, 7, 15, 0.58) 58%, rgba(12, 1, 3, 0.92) 100%)',
    accent:
      'radial-gradient(circle at 72% 22%, rgba(255, 234, 160, 0.22), transparent 28%), radial-gradient(circle at 92% 82%, rgba(248, 213, 106, 0.1), transparent 24%)',
    position: 'center',
    size: 'cover',
  },
  home: {
    color: '#170103',
    image: 'casino-city-hero.png',
    overlay:
      'linear-gradient(180deg, rgba(61, 2, 7, 0.92) 0%, rgba(118, 6, 13, 0.72) 48%, rgba(13, 1, 3, 0.96) 100%)',
    accent:
      'radial-gradient(circle at 16% 12%, rgba(255, 234, 160, 0.25), transparent 28%), radial-gradient(circle at 82% 20%, rgba(201, 13, 24, 0.34), transparent 30%)',
    position: 'center',
    size: 'cover',
  },
  shop: {
    color: '#170103',
    image: 'casino-rewards-showcase.png',
    overlay:
      'linear-gradient(180deg, rgba(54, 2, 7, 0.9) 0%, rgba(116, 6, 13, 0.74) 46%, rgba(13, 1, 3, 0.96) 100%)',
    accent:
      'radial-gradient(circle at 18% 18%, rgba(255, 234, 160, 0.22), transparent 30%), radial-gradient(circle at 78% 78%, rgba(201, 13, 24, 0.3), transparent 32%)',
    position: 'center',
    size: 'cover',
  },
}

export function getBackgroundStyle(name = 'app') {
  const preset = backgroundTheme[name] || backgroundTheme.app

  return {
    '--theme-bg-color': preset.color,
    '--theme-bg-image': asset(preset.image),
    '--theme-bg-overlay': preset.overlay || 'none',
    '--theme-bg-accent': preset.accent || 'none',
    '--theme-bg-position': preset.position || 'center',
    '--theme-bg-size': preset.size || 'cover',
  }
}

export function getDecorativeAssetStyle(name) {
  const preset = decorativeAssets[name] || decorativeAssets.homeHero

  return {
    '--decorative-image': asset(preset.image),
    '--decorative-overlay': preset.overlay || 'linear-gradient(135deg, rgba(24, 24, 27, 0.72), rgba(9, 9, 11, 0.92))',
  }
}
