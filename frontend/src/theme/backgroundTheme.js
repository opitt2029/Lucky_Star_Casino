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
    caption: '單線拉霸，100 星幣起玩。',
    meta: 'Slot',
    assetKey: 'slotGame',
  },
  {
    id: 'baccarat',
    to: '/game/baccarat',
    title: '百家樂',
    caption: '押莊、押閒或和局，節奏俐落。',
    meta: 'Baccarat',
    assetKey: 'baccaratGame',
  },
  {
    id: 'fishing',
    to: '/game/fishing',
    title: '捕魚機',
    caption: 'Buy-in 進場，瞄準魚群累積戰果。',
    meta: 'Fishing',
    assetKey: 'fishingGame',
  },
  {
    id: 'provably-fair',
    to: '/provably-fair',
    title: '公平性驗證',
    caption: '看見每一局如何被鎖定與驗證',
    meta: '透明局',
    assetKey: 'provablyFair',
  },
]

export const shopCatalog = [
  {
    id: 'vip-ticket',
    title: 'VIP 入場券',
    caption: '可收藏的活動通行券，適合兌換限時桌台資格。',
    cost: 12000,
    assetKey: 'shopPrizeA',
  },
  {
    id: 'avatar-frame',
    title: '會員頭像框',
    caption: '會員中心展示用頭像框，讓帳戶更有辨識度。',
    cost: 8000,
    assetKey: 'shopPrizeB',
  },
  {
    id: 'bonus-box',
    title: '幸運禮盒',
    caption: '適合活動獎勵或驚喜收藏的禮盒。',
    cost: 20000,
    assetKey: 'shopPrizeC',
  },
  {
    id: 'royal-nameplate',
    title: '皇家暱稱牌',
    caption: '會員中心展示用裝飾名牌，讓暱稱更有主角感。',
    cost: 15000,
    assetKey: 'shopRoyalNameplate',
  },
  {
    id: 'star-title-badge',
    title: '星耀稱號徽章',
    caption: '可收藏的帳戶稱號裝飾，適合活動或排行獎勵展示。',
    cost: 10000,
    assetKey: 'shopTitleBadge',
  },
  {
    id: 'profile-backdrop',
    title: '星河會員背景',
    caption: '會員中心展示用背景收藏，適合打造專屬風格。',
    cost: 18000,
    assetKey: 'shopProfileBackdrop',
  },
  {
    id: 'coin-rain-entry',
    title: '金幣雨入場特效',
    caption: '帳戶展示用入場特效收藏，讓會員頁更有儀式感。',
    cost: 16000,
    assetKey: 'shopCoinRain',
  },
  {
    id: 'daily-luck-pass',
    title: '每日幸運券',
    caption: '適合活動發放的輕量獎勵券，可先收藏到背包。',
    cost: 6000,
    assetKey: 'shopLuckPass',
  },
  {
    id: 'high-roller-invite',
    title: '高額桌邀請函',
    caption: '收藏型活動邀請函，適合兌換專屬活動資格。',
    cost: 30000,
    assetKey: 'shopHighRollerInvite',
  },
  {
    id: 'lucky-charm',
    title: '幸運星護符',
    caption: '低門檻收藏獎勵，適合新手完成任務後兌換。',
    cost: 5000,
    assetKey: 'shopLuckyCharm',
  },
]

export const decorativeAssets = {
  homeHero: {
    image: 'casino-city-hero.png',
    meta: 'Neon Boulevard',
    label: '幸運星幣城',
    caption: '在霓虹賭城中累積星幣、挑戰遊戲，打造你的會員旅程。',
    overlay:
      'linear-gradient(90deg, rgba(32, 1, 5, 0.72) 0%, rgba(92, 5, 12, 0.3) 46%, rgba(8, 1, 3, 0.76) 100%), radial-gradient(circle at 82% 18%, rgba(255, 230, 148, 0.12), transparent 34%)',
  },
  homeGames: {
    image: 'casino-game-hall.png',
    meta: 'Game Hall',
    label: '熱門遊戲大廳',
    caption: '從老虎機、百家樂到捕魚機，快速找到你的下一場挑戰。',
    overlay:
      'linear-gradient(135deg, rgba(72, 3, 8, 0.56) 0%, rgba(12, 1, 3, 0.78) 100%), radial-gradient(circle at 18% 20%, rgba(248, 213, 106, 0.12), transparent 32%)',
  },
  memberHero: {
    image: 'casino-city-hero.png',
    meta: 'Member Gate',
    label: '會員中心入口',
    caption: '管理個人資料、好友、簽到與帳戶狀態。',
    overlay:
      'linear-gradient(180deg, rgba(64, 3, 8, 0.48) 0%, rgba(12, 1, 3, 0.82) 100%), radial-gradient(circle at 70% 16%, rgba(255, 234, 160, 0.14), transparent 30%)',
  },
  gamesGallery: {
    image: 'casino-game-hall.png',
    meta: 'Game Directory',
    label: '遊戲目錄',
    caption: '瀏覽所有可玩的遊戲，選擇適合當下節奏的玩法。',
    overlay:
      'linear-gradient(135deg, rgba(70, 3, 8, 0.5) 0%, rgba(10, 1, 3, 0.82) 100%), radial-gradient(circle at 78% 24%, rgba(248, 213, 106, 0.12), transparent 32%)',
  },
  slotGame: {
    image: 'casino-game-hall.png',
    meta: 'Slot Game',
    label: '老虎機挑戰',
    caption: '簡單直接的轉輪節奏，適合快速累積遊戲回合。',
    overlay:
      'linear-gradient(135deg, rgba(188, 11, 21, 0.2) 0%, rgba(12, 1, 3, 0.8) 100%), radial-gradient(circle at 22% 18%, rgba(255, 234, 160, 0.12), transparent 28%)',
  },
  baccaratGame: {
    image: 'casino-game-hall.png',
    meta: 'Baccarat',
    label: '百家樂牌局',
    caption: '押莊、押閒或和局，用直覺判斷下一手。',
    overlay:
      'linear-gradient(135deg, rgba(132, 7, 14, 0.26) 0%, rgba(12, 1, 3, 0.8) 100%), radial-gradient(circle at 76% 18%, rgba(248, 213, 106, 0.12), transparent 30%)',
  },
  fishingGame: {
    image: 'casino-game-hall.png',
    meta: 'Fishing',
    label: '深海捕魚場',
    caption: '鎖定魚群、累積傷害，享受節奏明快的射擊體驗。',
    overlay:
      'linear-gradient(135deg, rgba(6, 40, 61, 0.62) 0%, rgba(2, 21, 34, 0.86) 100%), radial-gradient(circle at 24% 20%, rgba(120, 220, 255, 0.16), transparent 32%)',
  },
  provablyFair: {
    image: 'casino-game-hall.png',
    meta: 'Provably Fair',
    label: '公平性驗證展示',
    caption: '承諾／揭露／驗證五步驟拆解，逐步看見每一局怎麼被鎖定與驗算。',
    overlay:
      'linear-gradient(135deg, rgba(6, 61, 43, 0.5) 0%, rgba(2, 21, 34, 0.86) 100%), radial-gradient(circle at 24% 20%, rgba(123, 255, 176, 0.14), transparent 32%)',
  },
  shopHero: {
    image: 'casino-rewards-showcase.png',
    meta: 'Reward Shop',
    label: '星幣禮品商城',
    caption: '把累積的星幣換成收藏獎勵、活動資格與會員裝飾。',
    overlay:
      'linear-gradient(90deg, rgba(20, 1, 4, 0.72) 0%, rgba(110, 6, 13, 0.22) 58%, rgba(12, 1, 3, 0.78) 100%), radial-gradient(circle at 72% 24%, rgba(255, 234, 160, 0.14), transparent 34%)',
  },
  shopPrizeA: {
    image: 'shop-vip-ticket.svg',
    meta: 'VIP Reward',
    label: 'VIP 入場券',
    caption: '活動通行收藏，為限時桌台或專屬活動預留席位。',
    overlay:
      'linear-gradient(135deg, rgba(255, 214, 86, 0.08) 0%, rgba(24, 1, 4, 0.68) 100%)',
  },
  shopPrizeB: {
    image: 'shop-avatar-frame.svg',
    meta: 'Avatar Reward',
    label: '會員頭像框',
    caption: '帳戶展示裝飾，讓會員中心更有辨識度。',
    overlay:
      'linear-gradient(135deg, rgba(248, 213, 106, 0.08) 0%, rgba(28, 1, 5, 0.7) 100%)',
  },
  shopPrizeC: {
    image: 'shop-bonus-box.svg',
    meta: 'Lucky Box',
    label: '幸運禮盒',
    caption: '活動收藏禮盒，適合兌換驚喜獎勵。',
    overlay:
      'linear-gradient(135deg, rgba(201, 13, 24, 0.12) 0%, rgba(18, 1, 4, 0.7) 100%), radial-gradient(circle at 76% 22%, rgba(255, 234, 160, 0.1), transparent 28%)',
  },
  shopRoyalNameplate: {
    image: 'shop-royal-nameplate.svg',
    meta: 'Account Decor',
    label: '皇家暱稱牌',
    caption: '會員中心展示用名牌，讓玩家暱稱更像主角。',
    overlay:
      'linear-gradient(135deg, rgba(255, 225, 128, 0.1) 0%, rgba(35, 2, 8, 0.72) 100%)',
  },
  shopTitleBadge: {
    image: 'shop-title-badge.svg',
    meta: 'Account Decor',
    label: '星耀稱號徽章',
    caption: '收藏式稱號徽章，適合排行與活動獎勵展示。',
    overlay:
      'linear-gradient(135deg, rgba(86, 180, 255, 0.12) 0%, rgba(16, 2, 28, 0.75) 100%)',
  },
  shopProfileBackdrop: {
    image: 'shop-profile-backdrop.svg',
    meta: 'Account Decor',
    label: '星河會員背景',
    caption: '會員中心背景收藏，營造專屬帳戶風格。',
    overlay:
      'linear-gradient(135deg, rgba(90, 95, 255, 0.12) 0%, rgba(16, 2, 34, 0.76) 100%)',
  },
  shopCoinRain: {
    image: 'shop-coin-rain.svg',
    meta: 'Account Decor',
    label: '金幣雨入場特效',
    caption: '展示用入場特效收藏，讓會員頁更有儀式感。',
    overlay:
      'linear-gradient(135deg, rgba(255, 198, 64, 0.14) 0%, rgba(28, 8, 1, 0.74) 100%)',
  },
  shopLuckPass: {
    image: 'shop-luck-pass.svg',
    meta: 'Daily Reward',
    label: '每日幸運券',
    caption: '輕量收藏券，適合作為每日任務或活動獎勵。',
    overlay:
      'linear-gradient(135deg, rgba(52, 211, 153, 0.12) 0%, rgba(2, 32, 24, 0.76) 100%)',
  },
  shopHighRollerInvite: {
    image: 'shop-high-roller-invite.svg',
    meta: 'Event Invite',
    label: '高額桌邀請函',
    caption: '收藏型邀請函，適合兌換限時桌台或活動資格。',
    overlay:
      'linear-gradient(135deg, rgba(255, 214, 86, 0.1) 0%, rgba(19, 8, 28, 0.76) 100%)',
  },
  shopLuckyCharm: {
    image: 'shop-lucky-charm.svg',
    meta: 'Starter Reward',
    label: '幸運星護符',
    caption: '低門檻收藏獎勵，適合新手任務後兌換。',
    overlay:
      'linear-gradient(135deg, rgba(252, 165, 165, 0.13) 0%, rgba(42, 4, 8, 0.74) 100%)',
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