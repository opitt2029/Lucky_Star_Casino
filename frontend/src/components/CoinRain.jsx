const coins = Array.from({ length: 42 }, (_, index) => {
  const column = (index * 37) % 100
  const delay = -((index * 0.73) % 12)
  const duration = 8.5 + (index % 7) * 1.35
  const sizePattern = [9, 13, 18, 24, 32, 40, 52]
  const opacityPattern = [0.18, 0.28, 0.38, 0.52, 0.66, 0.78, 0.92]
  const size = sizePattern[index % sizePattern.length]
  const opacity = opacityPattern[(index * 3) % opacityPattern.length]
  const drift = ((index % 2 === 0 ? 1 : -1) * (18 + (index % 4) * 8))
  const spin = index % 2 === 0 ? 1 : -1

  return {
    id: `coin-${index}`,
    style: {
      '--coin-left': `${column}%`,
      '--coin-delay': `${delay}s`,
      '--coin-duration': `${duration}s`,
      '--coin-size': `${size}px`,
      '--coin-opacity': opacity,
      '--coin-drift': `${drift}px`,
      '--coin-spin': spin,
    },
  }
})

export default function CoinRain() {
  return (
    <div className="coin-rain" aria-hidden="true">
      {coins.map((coin) => (
        <span key={coin.id} className="coin-rain__coin" style={coin.style} />
      ))}
    </div>
  )
}
