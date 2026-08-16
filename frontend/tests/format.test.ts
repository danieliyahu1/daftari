import { formatDate, kasToSompi, shortAddress, shortTxid, sompiToKas } from '../src/format'

describe('sompiToKas', () => {
  it('converts whole KAS with thousands separators', () => {
    expect(sompiToKas('100000000')).toBe('1')
    expect(sompiToKas('15000000000')).toBe('150')
    expect(sompiToKas('12345678900000000')).toBe('123,456,789')
  })

  it('converts fractional KAS', () => {
    expect(sompiToKas('150000000')).toBe('1.5')
    expect(sompiToKas('123456789')).toBe('1.23456789')
    expect(sompiToKas('1')).toBe('0.00000001')
  })

  it('handles zero', () => {
    expect(sompiToKas('0')).toBe('0')
  })
})

describe('kasToSompi', () => {
  it('converts whole KAS', () => {
    expect(kasToSompi('1')).toBe('100000000')
    expect(kasToSompi('150')).toBe('15000000000')
  })

  it('converts fractional KAS', () => {
    expect(kasToSompi('1.5')).toBe('150000000')
    expect(kasToSompi('0.00000001')).toBe('1')
  })

  it('rejects invalid amounts', () => {
    expect(() => kasToSompi('abc')).toThrow()
    expect(() => kasToSompi('-1')).toThrow()
    expect(() => kasToSompi('1.123456789')).toThrow()
  })
})

describe('shortAddress and shortTxid', () => {
  it('shortens long identifiers', () => {
    const addr = 'kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl'
    expect(shortAddress(addr)).toBe('kaspat...ukdl')
  })

  it('returns short identifiers untouched', () => {
    expect(shortAddress('abc')).toBe('abc')
    expect(shortTxid('1234567890abcdef')).toBe('1234567890abcdef')
  })

  it('shortens txids', () => {
    const txid = '0'.repeat(64)
    expect(shortTxid(txid)).toBe('00000000...000000')
  })
})

describe('formatDate', () => {
  it('formats an epoch timestamp', () => {
    const formatted = formatDate(1_700_000_000)
    expect(formatted).toContain('2023')
  })

  it('handles missing dates', () => {
    expect(formatDate(0)).toBe('—')
    expect(formatDate(Number.NaN)).toBe('—')
  })
})
