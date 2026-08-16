import { act, renderHook, waitFor } from '@testing-library/react'
import type { KastleExtension } from '../../src/wallet/kastle'
import { extractSignedTx, isUserRejection, useKastle, withTimeout } from '../../src/wallet/kastle'

const ADDR = 'kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl'

type MockKastle = KastleExtension & {
  emit: (event: string, ...args: unknown[]) => void
}

function installMockKastle(
  overrides: Partial<Record<keyof KastleExtension, unknown>> = {},
): MockKastle {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const mock = {
    connect: overrides.connect ?? vi.fn(async () => undefined),
    getAccount: overrides.getAccount ?? vi.fn(async () => ({ address: ADDR })),
    getNetwork: overrides.getNetwork ?? vi.fn(async () => 'testnet-10'),
    switchNetwork: overrides.switchNetwork ?? vi.fn(async () => undefined),
    signTx:
      overrides.signTx ??
      vi.fn(async (_networkId: string | undefined, txJson: unknown) => {
        if (typeof txJson !== 'string') {
          throw new Error('signTx: txJson must be a string')
        }
        return { txJson: 'signed' }
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

function uninstallKastle(): void {
  delete window.kastle
}

describe('useKastle wallet layer', () => {
  afterEach(() => {
    uninstallKastle()
    vi.restoreAllMocks()
  })

  it('starts not-installed when no window.kastle', () => {
    uninstallKastle()
    const { result } = renderHook(() => useKastle())
    expect(result.current.status).toBe('not-installed')
    expect(result.current.address).toBeNull()
  })

  it('starts disconnected when Kastle is installed', () => {
    installMockKastle({ getAccount: vi.fn(async () => ({ address: '' })) })
    const { result } = renderHook(() => useKastle())
    expect(result.current.status).toBe('disconnected')
  })

  it('restores a connected account on mount', async () => {
    installMockKastle()
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.address).toBe(ADDR)
    expect(result.current.network).toBe('testnet-10')
  })

  it('detects a wallet injected after mount', async () => {
    uninstallKastle()
    const { result } = renderHook(() => useKastle())
    expect(result.current.status).toBe('not-installed')

    installMockKastle()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.address).toBe(ADDR)
    expect(result.current.network).toBe('testnet-10')
  })

  it('connects on request and lands on connected for the right network', async () => {
    const mock = installMockKastle({
      getAccount: vi
        .fn()
        .mockRejectedValueOnce(new Error('no account'))
        .mockResolvedValueOnce({ address: ADDR }),
      getNetwork: vi.fn(async () => 'kaspa_testnet_10'),
    })
    const { result } = renderHook(() => useKastle())
    expect(result.current.status).toBe('disconnected')
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.status).toBe('connected')
    expect(result.current.address).toBe(ADDR)
    expect(result.current.network).toBe('testnet-10')
    expect(mock.connect).toHaveBeenCalled()
  })

  it('lands on wrong-network when the wallet is on another network', async () => {
    installMockKastle({
      getAccount: vi.fn(async () => ({ address: ADDR })),
      getNetwork: vi.fn(async () => 'mainnet'),
    })
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('wrong-network'))
    expect(result.current.network).toBe('mainnet')
  })

  it('switches to testnet-10 from wrong-network when the user accepts', async () => {
    const mock = installMockKastle({
      getAccount: vi.fn(async () => ({ address: ADDR })),
      getNetwork: vi
        .fn()
        .mockResolvedValueOnce('mainnet')
        .mockResolvedValueOnce('testnet-10'),
    })
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('wrong-network'))
    await act(async () => {
      await result.current.switchToTestnet()
    })
    expect(mock.switchNetwork).toHaveBeenCalledWith('testnet-10')
    expect(result.current.status).toBe('connected')
  })

  it('stays on wrong-network when the network switch is declined', async () => {
    installMockKastle({
      getAccount: vi.fn(async () => ({ address: ADDR })),
      getNetwork: vi.fn(async () => 'mainnet'),
      switchNetwork: vi.fn(async () => {
        throw new Error('user denied')
      }),
    })
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('wrong-network'))
    await act(async () => {
      await result.current.switchToTestnet()
    })
    expect(result.current.status).toBe('wrong-network')
    expect(result.current.error).toBe('Network switch declined.')
  })

  it('handles a failed connect gracefully', async () => {
    installMockKastle({
      getAccount: vi.fn(async () => {
        throw new Error('disconnected')
      }),
    })
    const { result } = renderHook(() => useKastle())
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.error).toBe("Couldn't connect your wallet.")
  })

  it('treats a user-cancelled connect as cancelled, not an error', async () => {
    installMockKastle({
      getAccount: vi.fn(async () => {
        const error = new Error('user rejected the request')
        ;(error as { code?: number }).code = 4001
        throw error
      }),
    })
    const { result } = renderHook(() => useKastle())
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.error).toBe('Connection cancelled.')
  })

  it('disconnects when accountsChanged fires empty', async () => {
    const mock = installMockKastle()
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    act(() => mock.emit('accountsChanged', []))
    await waitFor(() => expect(result.current.status).toBe('disconnected'))
    expect(result.current.address).toBeNull()
  })

  it('connects when accountsChanged fires an account', async () => {
    const mock = installMockKastle({
      getAccount: vi.fn(async () => {
        throw new Error('no account')
      }),
    })
    const { result } = renderHook(() => useKastle())
    expect(result.current.status).toBe('disconnected')
    act(() => mock.emit('accountsChanged', [ADDR]))
    await waitFor(() => expect(result.current.status).toBe('connected'))
    expect(result.current.address).toBe(ADDR)
  })

  it('re-evaluates the network when networkChanged fires', async () => {
    const mock = installMockKastle({
      getAccount: vi.fn(async () => ({ address: ADDR })),
      getNetwork: vi.fn(async () => 'testnet-10'),
    })
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    ;(mock.getNetwork as ReturnType<typeof vi.fn>).mockResolvedValueOnce('mainnet')
    act(() => mock.emit('networkChanged'))
    await waitFor(() => expect(result.current.status).toBe('wrong-network'))
  })

  it('disconnects on demand', async () => {
    installMockKastle()
    const { result } = renderHook(() => useKastle())
    await waitFor(() => expect(result.current.status).toBe('connected'))
    act(() => result.current.disconnect())
    expect(result.current.status).toBe('disconnected')
  })
})

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000)
    const result = await promise
    expect(result).toBe('ok')
  })

  it('rejects after the timeout elapses', async () => {
    const never = new Promise<string>(() => undefined)
    const promise = withTimeout(never, 1000)
    const assertion = expect(promise).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })
})

describe('extractSignedTx', () => {
  it('passes a string result through unchanged', () => {
    expect(extractSignedTx('{"version":0}')).toBe('{"version":0}')
  })

  it('reads the signed transaction from the common result shapes', () => {
    expect(extractSignedTx({ txJson: 'a' })).toBe('a')
    expect(extractSignedTx({ signedTx: 'b' })).toBe('b')
    expect(extractSignedTx({ tx: 'c' })).toBe('c')
  })

  it('prefers txJson when more than one shape is present', () => {
    expect(extractSignedTx({ txJson: 'a', signedTx: 'b', tx: 'c' })).toBe('a')
  })

  it('returns an empty string when no signed transaction is present', () => {
    expect(extractSignedTx({})).toBe('')
    expect(extractSignedTx({ foo: 'bar' } as { txJson?: string })).toBe('')
  })
})

describe('isUserRejection', () => {
  it('recognises rejected, cancelled, and denied wording', () => {
    expect(isUserRejection(new Error('User rejected the request'))).toBe(true)
    expect(isUserRejection(new Error('request cancelled'))).toBe(true)
    expect(isUserRejection(new Error('connection denied'))).toBe(true)
  })

  it('recognises error code 4001 on a thrown object', () => {
    expect(isUserRejection({ code: 4001, message: 'denied' })).toBe(true)
  })

  it('returns false for unrelated failures', () => {
    expect(isUserRejection(new Error('invalid_type: Expected string'))).toBe(false)
    expect(isUserRejection(new Error('boom'))).toBe(false)
    expect(isUserRejection({ code: -32000 })).toBe(false)
    expect(isUserRejection(null)).toBe(false)
    expect(isUserRejection('plain string')).toBe(false)
  })
})
