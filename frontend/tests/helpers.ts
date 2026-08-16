import type { KastleExtension } from '../src/wallet/kastle'

export const USER_ADDRESS = 'kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl'
export const CHAMA_ADDRESS = 'kaspatest:qpchy8753068rt2szvwxc0yr0kl38sjxqs0cg7xe97y6tzxh5h5wx09rle5a7'

export const GROUP_STUB = {
  address: CHAMA_ADDRESS,
  name: 'Plot',
  kind: 'group',
} as const

export function bookStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { balance_sompi: '0', rows: [], group: GROUP_STUB, ...overrides }
}

type MockKastle = KastleExtension & {
  emit: (event: string, ...args: unknown[]) => void
}

export function installConnectedKastle(address: string = USER_ADDRESS): MockKastle {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const mock = {
    connect: vi.fn(async () => undefined),
    getAccount: vi.fn(async () => ({ address })),
    getNetwork: vi.fn(async () => 'testnet-10'),
    switchNetwork: vi.fn(async () => undefined),
    signTx: vi.fn(async (_networkId: string | undefined, txJson: unknown) => {
      if (typeof txJson !== 'string') {
        throw new Error('signTx: txJson must be a string')
      }
      return { txJson: 'signed-tx' }
    }),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      ;(handlers[event] ??= []).push(handler)
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler)
    },
    emit: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach((handler) => handler(...args))
    },
  }
  window.kastle = mock as MockKastle
  return mock as MockKastle
}

export function uninstallKastle(): void {
  delete window.kastle
}

export function installDisconnectedKastle(): void {
  window.kastle = {
    connect: vi.fn(async () => undefined),
    getAccount: vi.fn(async () => ({})),
    getNetwork: vi.fn(async () => 'testnet-10'),
    switchNetwork: vi.fn(async () => undefined),
    signTx: vi.fn(async () => ({ txJson: 'signed-tx' })),
    on: () => {},
    off: () => {},
  } as unknown as MockKastle
}

export interface StubRoute {
  status?: number
  body?: unknown | (() => unknown)
}

export type ApiStubs = Record<string, StubRoute>

export function stubApi(stubs: ApiStubs): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsed = new URL(url, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${parsed.pathname}`
    const route = stubs[key]
    if (!route) {
      return new Response(
        JSON.stringify({ error: { kind: 'invalid', message: 'not stubbed' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const body = typeof route.body === 'function' ? (route.body as () => unknown)() : route.body
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

export function clearFetch(): void {
  vi.unstubAllGlobals()
}
