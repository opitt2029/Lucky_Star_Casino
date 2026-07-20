// Provably Fair 展示頁專用的本機模擬（方案 A，spec §4）。
// 純函式：以 Web Crypto 完整重現後端 rng/RandomStream 的 SHA-256 串流，
// 自產「真正可用同一支函式重算」的對局。數值來源沿用 contracts/*.json（與 mockApi 同源）。
// 誠實性（spec §4）：mock 的「重算」是前端拿同一支函式再跑一次，必然相符；
// 這不構成對後端的獨立驗證——UI 以徽章＋說明明示。

const encoder = new TextEncoder()

// UTF-8 → SHA-256 → 小寫 hex（對齊後端 ProvablyFairRng.sha256Hex）。
export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str))
  return bytesToHex(new Uint8Array(digest))
}

// 承諾雜湊 commitment = SHA-256(serverSeed)（對齊後端 ProvablyFairRng.commit）。
export async function commit(serverSeed) {
  return sha256Hex(serverSeed)
}

// 產生 byteLength 位元組的密碼學亂數，回小寫 hex。
export function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return bytesToHex(bytes)
}

function bytesToHex(bytes) {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

// 區塊訊息 serverSeed:clientSeed:nonce:block（對齊後端 RandomStream.blockMessage）。
async function sha256Bytes(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str))
  return new Uint8Array(digest)
}

// 由 (serverSeed, clientSeed, nonce) 建立確定性串流。介面全 async：
// 位元組用罄時「按需」以遞增 block 再雜湊延伸（對齊後端 nextByte），不預算固定塊數。
export function createStream(serverSeed, clientSeed, nonce) {
  if (!serverSeed) throw new Error('serverSeed 不可為空')
  if (!clientSeed) throw new Error('clientSeed 不可為空')
  let buffer = new Uint8Array(0)
  let position = 0
  let nextBlock = 0

  async function nextByte() {
    if (position >= buffer.length) {
      buffer = await sha256Bytes(`${serverSeed}:${clientSeed}:${nonce}:${nextBlock}`)
      nextBlock += 1
      position = 0
    }
    return buffer[position++]
  }

  async function nextU32() {
    let u = 0
    for (let i = 0; i < 4; i++) u = u * 256 + (await nextByte()) // big-endian，避免 <<32 溢位
    return u
  }

  async function nextDouble() {
    return (await nextU32()) / 4294967296 // 2^32
  }

  async function nextInt(bound) {
    if (!Number.isInteger(bound) || bound <= 0) throw new Error(`bound 必須為正整數，實際為 ${bound}`)
    const range = 4294967296 // 2^32
    const limit = range - (range % bound)
    // 拒絕取樣：落在不可整除尾段者丟棄，消除取模偏差（對齊後端）。
    while (true) {
      const u = await nextU32()
      if (u < limit) return u % bound
    }
  }

  async function nextInts(count, bound) {
    const out = []
    for (let i = 0; i < count; i++) out.push(await nextInt(bound))
    return out
  }

  return { nextByte, nextDouble, nextInt, nextInts }
}
