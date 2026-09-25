import { AppError, uuid } from './security.mjs'
export const PAYMENT_STATES = [
  'requires_payment_instrument',
  'requires_user_action',
  'pending',
  'completed',
  'failed',
  'canceled',
]
export const ZIINA_IPS = [
  '3.29.184.186',
  '3.29.190.95',
  '20.233.47.127',
  '13.202.161.181',
]
export const paymentMessage = (id) => `ELAN TEST ORDER ${id}`
export function orderFromMessage(message) {
  const id = String(message || '').replace(/^ELAN TEST ORDER /, '')
  return uuid(id) ? id : null
}
export function validateIntent(intent, order, accountId) {
  if (
    !uuid(intent?.id) ||
    !accountId ||
    intent.account_id !== accountId ||
    intent.amount !== order.total_minor ||
    intent.currency_code !== order.currency ||
    intent.message !== paymentMessage(order.id) ||
    (order.payment_intent_id && intent.id !== order.payment_intent_id) ||
    !PAYMENT_STATES.includes(intent.status) ||
    (intent.tip_amount ?? 0) !== 0 ||
    !order.test_mode
  )
    throw new AppError('PAYMENT_VERIFICATION_FAILED', 409)
  return intent
}
export function paymentURL(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new AppError('INVALID_PAYMENT_URL', 502)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(url.hostname === 'ziina.com' || url.hostname.endsWith('.ziina.com'))
  )
    throw new AppError('INVALID_PAYMENT_URL', 502)
  return url.href
}
export function createZiina(env, fetcher = fetch) {
  function assertConfigured() {
    if (
      !env.ZIINA_API_TOKEN ||
      !env.ZIINA_ACCOUNT_ID ||
      env.ZIINA_TEST_MODE !== 'true'
    )
      throw new AppError('PAYMENTS_NOT_CONFIGURED', 503)
    let origin
    try {
      origin = new URL(env.STOREFRONT_URL)
    } catch {
      throw new AppError('INVALID_STORE_URL', 503)
    }
    if (
      origin.origin !== env.STOREFRONT_URL ||
      (origin.protocol !== 'https:' && origin.hostname !== 'localhost')
    )
      throw new AppError('INVALID_STORE_URL', 503)
  }
  async function call(path, options = {}) {
    assertConfigured()
    let response
    try {
      response = await fetcher(`https://api-v2.ziina.com/api${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${env.ZIINA_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      })
    } catch {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 503)
    }
    if (!response.ok) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 503)
    try {
      return await response.json()
    } catch {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 503)
    }
  }
  return {
    assertConfigured,
    get(id) {
      if (!uuid(id)) throw new AppError('INVALID_PAYMENT_ID')
      return call(`/payment_intent/${id}`)
    },
    create(order) {
      const origin = new URL(env.STOREFRONT_URL)
      if (
        origin.origin !== env.STOREFRONT_URL ||
        (origin.protocol !== 'https:' && origin.hostname !== 'localhost')
      )
        throw new AppError('INVALID_STORE_URL', 503)
      const back = `${origin.origin}/checkout.html?order=${order.id}`
      // No undocumented provider idempotency parameter. The DB grants one POST attempt only.
      return call('/payment_intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: order.total_minor,
          currency_code: order.currency,
          test: true,
          allow_tips: false,
          message: paymentMessage(order.id),
          expiry: String(new Date(order.expires_at).getTime()),
          success_url: `${back}&result=success`,
          cancel_url: `${back}&result=cancel`,
          failure_url: `${back}&result=failure`,
        }),
      })
    },
  }
}
