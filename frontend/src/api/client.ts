import type { Book, Home, Membership, Wallet, WalletKind } from '../../../shared/types'
import { logger } from '../logger'

const BASE_URL = '/api'
const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiErrorBody {
  kind?: string
  message?: string
  source?: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = undefined) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.body = body
  }
}

let authToken: string | null = null

export function getAuthToken(): string | null {
  return authToken
}

export function setAuthToken(token: string | null): void {
  authToken = token
}

function buildUrl(base: string, path: string): string {
  return base ? `${base}${path}` : `${BASE_URL}${path}`
}

function requestHeaders(hasBody: boolean): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (authToken !== null) headers.Authorization = `Bearer ${authToken}`
  return Object.keys(headers).length > 0 ? headers : undefined
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractErrorMessage(parsed: unknown, status: number): string {
  const body = parsed as { error?: ApiErrorBody } | undefined
  const nestedMessage = body?.error?.message
  if (nestedMessage) return nestedMessage
  const flatMessage = (body as ApiErrorBody | undefined)?.message
  if (flatMessage) return flatMessage
  return `Request failed with status ${status}`
}

async function apiRequest<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = buildUrl(base, path)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const parsed = await parseResponseBody(response)

    if (!response.ok) {
      const message = extractErrorMessage(parsed, response.status)
      logger.warn('api error response', { status: response.status, url, method, message })
      throw new ApiClientError(response.status, message, parsed)
    }

    return parsed as T
  } catch (err) {
    if (err instanceof ApiClientError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      logger.error('api timeout', { url, method, timeoutMs })
      throw new ApiClientError(0, 'The request timed out. Check your connection and try again.', { kind: 'network' })
    }
    const message = err instanceof Error ? err.message : String(err)
    logger.error('api network error', { url, method, message })
    throw new ApiClientError(0, 'Network error. Check your connection and try again.', { kind: 'network' })
  } finally {
    clearTimeout(timer)
  }
}

export function createApiClient(baseUrl?: string) {
  function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return apiRequest<T>(baseUrl ?? '', method, path, body)
  }

  return {
    createChallenge(address: string): Promise<{ nonce: string; message: string }> {
      return request('POST', '/auth/challenge', { address })
    },
    createSession(message: string, signature: string): Promise<{ token: string; expires_in_seconds: number }> {
      return request('POST', '/auth/session', { message, signature })
    },
    getHome(): Promise<Home> {
      return request('GET', '/memberships')
    },
    addMember(data: { group_address: string; member_address: string }): Promise<{ membership: Membership }> {
      return request('POST', '/memberships', data)
    },
    registerWallet(data: { name: string; kind: WalletKind }): Promise<{ wallet: Wallet }> {
      return request('POST', '/wallets/register', data)
    },
    resolveWallets(addresses: string[]): Promise<{ wallets: Wallet[] }> {
      return request('GET', `/wallets/resolve?addresses=${encodeURIComponent(addresses.join(','))}`)
    },
    getBook(code: string, limit: number, offset: number): Promise<Book> {
      return request('GET', `/chamas/${encodeURIComponent(code)}/book?limit=${limit}&offset=${offset}`)
    },
    preparePayment(data: {
      chama_address: string
      amount_sompi: string
    }): Promise<{ signing_template: string }> {
      return request('POST', '/payments/prepare', data)
    },
    finalizePayment(data: { signed: string }): Promise<{
      status: 'recorded' | 'pending'
      txid: string
      explorer_url?: string
    }> {
      return request('POST', '/payments/finalize', data)
    },
    prepareWithdrawal(data: {
      fund_address: string
      recipient_address: string
      amount_sompi: string
    }): Promise<{ signing_template: string }> {
      return request('POST', '/withdrawals/prepare', data)
    },
    finalizeWithdrawal(data: {
      fund_address: string
      recipient_address: string
      amount_sompi: string
      signed: string
    }): Promise<{
      status: 'recorded' | 'pending'
      txid: string
      explorer_url?: string
    }> {
      return request('POST', '/withdrawals/finalize', data)
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export const apiClient = createApiClient()
