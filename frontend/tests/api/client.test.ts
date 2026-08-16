import { ApiClientError, createApiClient } from '../../src/api/client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists memberships for the connected address', async () => {
    const memberships = [
      { user_address: 'user', chama_address: 'chama', created_at: 1 },
    ]
    global.fetch = vi.fn(async () => jsonResponse(200, { memberships }))

    const result = await createApiClient().listMemberships('kaspatest:abc')

    expect(result.memberships).toEqual(memberships)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships?user=kaspatest%3Aabc',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('joins a chama with a POST and the addresses in the body', async () => {
    global.fetch = vi.fn(async () => jsonResponse(201, { outcome: 'joined' }))

    await createApiClient().joinMembership({
      user_address: 'user',
      chama_address: 'chama',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user_address: 'user', chama_address: 'chama' }),
      }),
    )
  })

  it('leaves a chama with a DELETE', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { outcome: 'left' }))

    await createApiClient().leaveMembership({
      user_address: 'user',
      chama_address: 'chama',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/memberships',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('reads the book with encoded code and pagination query', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, { balance_sompi: '0', rows: [] }),
    )

    await createApiClient().getBook('kaspatest:abc', 50, 100)

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chamas/kaspatest%3Aabc/book?limit=50&offset=100',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('prepares a payment with the amount in sompi', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(200, { signing_template: '{"version":0}' }),
    )

    const result = await createApiClient().preparePayment({
      user_address: 'user',
      chama_address: 'chama',
      amount_sompi: '100000000',
    })

    expect(result.signing_template).toBe('{"version":0}')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/payments/prepare',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          user_address: 'user',
          chama_address: 'chama',
          amount_sompi: '100000000',
        }),
      }),
    )
  })

  it('finalizes a payment with the signed transaction', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { txid: 'ab'.repeat(32) }))

    const result = await createApiClient().finalizePayment({ signed: 'signed-json' })

    expect(result.txid).toBe('ab'.repeat(32))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/payments/finalize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signed: 'signed-json' }),
      }),
    )
  })

  it('prepends a base url when provided', async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { ok: true }))

    await createApiClient('http://localhost:4100/api').getBook('kaspatest:abc', 50, 0)

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4100/api/chamas/kaspatest%3Aabc/book?limit=50&offset=0',
      expect.anything(),
    )
  })

  it('extracts the message from a nested error body', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse(422, { error: { kind: 'invalid', message: 'That code is not valid' } }),
    )

    const promise = createApiClient().joinMembership({
      user_address: 'user',
      chama_address: 'bad',
    })
    const error = await promise.catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiClientError)
    const apiError = error as ApiClientError
    expect(apiError.status).toBe(422)
    expect(apiError.message).toBe('That code is not valid')
    expect(apiError.body).toEqual({ error: { kind: 'invalid', message: 'That code is not valid' } })
  })

  it('extracts a flat error message', async () => {
    global.fetch = vi.fn(async () => jsonResponse(503, { message: 'Upstream unavailable' }))

    const error = (await createApiClient()
      .listMemberships('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(503)
    expect(error.message).toBe('Upstream unavailable')
  })

  it('falls back to the status text for a non-JSON error body', async () => {
    global.fetch = vi.fn(async () => new Response('oops', { status: 500 }))

    const error = (await createApiClient()
      .listMemberships('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(500)
    expect(error.message).toBe('Request failed with status 500')
  })

  it('surfaces a request timeout as a status-0 network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const error = (await createApiClient()
      .listMemberships('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/timed out/)
  })

  it('surfaces a network failure as a status-0 network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = (await createApiClient()
      .listMemberships('kaspatest:abc')
      .catch((err: unknown) => err)) as ApiClientError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Network error/)
  })
})
