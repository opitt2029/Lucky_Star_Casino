export const socialProviders = [
  {
    id: 'line',
    label: 'LINE',
    accentClass: 'border-emerald-300/50 bg-emerald-500/12 text-emerald-100',
    glowClass: 'shadow-[0_0_36px_rgba(16,185,129,0.22)]',
  },
  {
    id: 'google',
    label: 'Google',
    accentClass: 'border-sky-300/50 bg-sky-500/12 text-sky-100',
    glowClass: 'shadow-[0_0_36px_rgba(56,189,248,0.2)]',
  },
  {
    id: 'apple',
    label: 'Apple',
    accentClass: 'border-zinc-200/50 bg-zinc-200/12 text-zinc-100',
    glowClass: 'shadow-[0_0_36px_rgba(244,244,245,0.14)]',
  },
]

export function getBirthDateMax(today = new Date()) {
  const max = new Date(today)
  max.setFullYear(max.getFullYear() - 18)
  return max.toISOString().slice(0, 10)
}

export function isAdultBirthDate(value, today = new Date()) {
  if (!value) return false
  const birthDate = new Date(`${value}T00:00:00`)
  if (Number.isNaN(birthDate.getTime())) return false
  const adultDate = new Date(birthDate)
  adultDate.setFullYear(adultDate.getFullYear() + 18)
  return adultDate <= today
}
