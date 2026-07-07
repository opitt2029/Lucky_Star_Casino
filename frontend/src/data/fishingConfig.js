export const FISHING_AMMO_OPTIONS = [
  {
    level: 1,
    key: 'light',
    label: '小型彈藥',
    badge: '小',
    costPerShot: 10,
    description: '低消耗連射',
    tone: 'copper',
  },
  {
    level: 2,
    key: 'normal',
    label: '普通彈藥',
    badge: '普',
    costPerShot: 50,
    description: '穩定追擊',
    tone: 'silver',
  },
  {
    level: 3,
    key: 'heavy',
    label: '重型彈藥',
    badge: '重',
    costPerShot: 100,
    description: '高額火力',
    tone: 'gold',
  },
]

export const getFishingAmmoByLevel = (level) =>
  FISHING_AMMO_OPTIONS.find((option) => option.level === level) || FISHING_AMMO_OPTIONS[0]
