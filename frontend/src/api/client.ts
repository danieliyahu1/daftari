import type { Book, Membership } from '../../../shared/types'
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

async function apiRequest<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = base ? `${base}${path}` : `${BASE_URL}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    let parsed: unknown = undefined
    const text = await response.text().catch(() => '')
    if (text !== '') {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      const errBody = parsed as { error?: ApiErrorBody } | undefined
      const nested = errBody?.error
      const nestedMessage = typeof nested?.message === 'string' ? nested.message : ''
      const flatBody = errBody as ApiErrorBody | undefined
      const flatMessage = typeof flatBody?.message === 'string' ? flatBody.message : ''
      const message =
        nestedMessage !== ''
          ? nestedMessage
          : flatMessage !== ''
            ? flatMessage
            : `Request failed with status ${response.status}`
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
    listMemberships(userAddress: string): Promise<{ memberships: Membership[] }> {
      return request('GET', `/memberships?user=${encodeURIComponent(userAddress)}`)
    },
    joinMembership(data: { user_address: string; chama_address: string }): Promise<unknown> {
      return request('POST', '/memberships', data)
    },
    leaveMembership(data: { user_address: string; chama_address: string }): Promise<unknown> {
      return request('DELETE', '/memberships', data)
    },
    getBook(code: string, limit: number, offset: number): Promise<Book> {
      return request('GET', `/chamas/${encodeURIComponent(code)}/book?limit=${limit}&offset=${offset}`)
    },
    preparePayment(data: {
      user_address: string
      chama_address: string
      amount_sompi: string
    }): Promise<{ signing_template: string }> {
      return request('POST', '/payments/prepare', data)
    },
    finalizePayment(data: { signed: string }): Promise<{ txid: string }> {
      return request('POST', '/payments/finalize', data)
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export const apiClient = createApiClient()
