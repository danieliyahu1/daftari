const SOMPI_PER_KAS = 100_000_000n

function truncateMiddle(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 3) return text
  return `${text.slice(0, head)}...${text.slice(-tail)}`
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  return truncateMiddle(address, head, tail)
}

export function shortTxid(txid: string, head = 8, tail = 6): string {
  return truncateMiddle(txid, head, tail)
}

export function sompiToKas(sompi: string): string {
  const value = BigInt(sompi)
  const whole = value / SOMPI_PER_KAS
  const frac = value % SOMPI_PER_KAS
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (frac === 0n) return grouped
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '')
  return `${grouped}.${fracStr}`
}

export function kasToSompi(kas: string): string {
  const trimmed = kas.trim()
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) {
    throw new Error('Amount must be a positive number with up to 8 decimal places')
  }
  const [whole = '0', frac = ''] = trimmed.split('.')
  const fracPadded = frac.padEnd(8, '0')
  return (BigInt(whole) * SOMPI_PER_KAS + BigInt(fracPadded)).toString()
}

export function formatDate(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return '—'
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochSeconds * 1000))
}

export function formatKastleNetwork(network: string | null): string {
  return network === 'testnet-10' ? 'testnet-10' : 'unknown'
}
