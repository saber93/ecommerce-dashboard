export class AppError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  )
export async function sha256(value) {
  const data =
    typeof value === 'string' ? new TextEncoder().encode(value) : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
export async function verifySignature(bytes, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const decoded = Uint8Array.from(signature.match(/../g), (byte) =>
    parseInt(byte, 16),
  )
  return crypto.subtle.verify('HMAC', key, decoded, bytes)
}
export async function readBody(request, maxBytes = 32768) {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel()
      throw new AppError('REQUEST_TOO_LARGE', 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
export function parseBody(bytes) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AppError('INVALID_JSON')
  }
}
export function validateCheckout(input) {
  if (
    !input ||
    !uuid(input.request_key) ||
    !/^[a-f0-9]{64}$/.test(input.token || '')
  )
    throw new AppError('INVALID_CHECKOUT')
  const c = input.customer || {}
  const lengths = {
    name: [2, 120],
    email: [3, 254],
    phone: [7, 30],
    address: [4, 300],
    city: [2, 100],
    country: [2, 2],
  }
  const customer = {}
  for (const [key, [min, max]] of Object.entries(lengths)) {
    if (
      typeof c[key] !== 'string' ||
      c[key].trim().length < min ||
      c[key].trim().length > max
    )
      throw new AppError('INVALID_CUSTOMER')
    customer[key] = c[key].trim()
  }
  customer.email = customer.email.toLowerCase()
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
    !/^[A-Z]{2}$/.test(customer.country)
  )
    throw new AppError('INVALID_CUSTOMER')
  return { customer, items: validateItems(input.items) }
}
export function validateItems(rawItems) {
  if (
    !Array.isArray(rawItems) ||
    rawItems.length < 1 ||
    rawItems.length > 20
  )
    throw new AppError('INVALID_ITEMS')
  const items = rawItems
    .map((i) => {
      if (
        !i ||
        !/^[a-z0-9][a-z0-9-]{0,79}$/.test(i.id) ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 20
      )
        throw new AppError('INVALID_ITEMS')
      return { id: i.id, quantity: i.quantity }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new AppError('DUPLICATE_ITEMS')
  return items
}
export function validateProduct(p) {
  if (
    !p ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.id || '') ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 160
  )
    throw new AppError('INVALID_PRODUCT')
  if (
    !['face', 'lips', 'eyes'].includes(p.category) ||
    !Number.isInteger(p.price_minor) ||
    p.price_minor < 1 ||
    p.price_minor > 100000000 ||
    !Number.isInteger(p.stock_quantity) ||
    p.stock_quantity < 0 ||
    p.stock_quantity > 1000000 ||
    typeof p.active !== 'boolean'
  )
    throw new AppError('INVALID_PRODUCT')
  if (
    typeof p.description !== 'string' ||
    p.description.length > 2000 ||
    typeof p.badge !== 'string' ||
    p.badge.length > 80 ||
    typeof p.image !== 'string'
  )
    throw new AppError('INVALID_PRODUCT')
  const validImage = (image) => {
    if (typeof image !== 'string' || image.length > 2048) return false
    if (/^\.\/assets\/[a-z0-9-]+\.png$/i.test(image)) return true
    try {
      const url = new URL(image)
      return url.protocol === 'https:' && !url.username && !url.password
    } catch { return false }
  }
  if (!validImage(p.image)) throw new AppError('INVALID_IMAGE')
  if (
    !Array.isArray(p.swatches) ||
    p.swatches.length > 12 ||
    p.swatches.some((c) => !/^#[a-f0-9]{6}$/i.test(c))
  )
    throw new AppError('INVALID_SWATCHES')
  if (Object.hasOwn(p, 'collections') && (!Array.isArray(p.collections) || p.collections.length > 4 ||
      new Set(p.collections).size !== p.collections.length ||
      p.collections.some((key) => !['work', 'evening', 'weekend', 'gifts'].includes(key))))
    throw new AppError('INVALID_PRODUCT')
  if (Object.hasOwn(p, 'gallery') && (!Array.isArray(p.gallery) || p.gallery.length > 8 ||
      p.gallery.some((image) => !validImage(image))))
    throw new AppError('INVALID_IMAGE')
  if (Object.hasOwn(p, 'fit_visual_url') &&
      (typeof p.fit_visual_url !== 'string' ||
       (p.fit_visual_url !== '' && !validImage(p.fit_visual_url))))
    throw new AppError('INVALID_IMAGE')
  for (const [key, max] of [['fits_inside_en',300],['fits_inside_ar',300],
    ['styling_en',400],['styling_ar',400],['dimensions_cm',100]]) {
    if (Object.hasOwn(p, key) && (typeof p[key] !== 'string' || p[key].length > max)) throw new AppError('INVALID_PRODUCT')
  }
  if ((Object.hasOwn(p, 'limited_edition') && typeof p.limited_edition !== 'boolean') ||
      (Object.hasOwn(p, 'photo_verified') && typeof p.photo_verified !== 'boolean') ||
      (Object.hasOwn(p, 'fit_verified') && typeof p.fit_verified !== 'boolean') ||
      (p.limited_edition && (!Number.isInteger(p.edition_size) || p.edition_size < 1 || p.edition_size > 1000000)) ||
      (Object.hasOwn(p, 'limited_edition') && !p.limited_edition && p.edition_size != null) ||
      (p.pair_product_id && (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.pair_product_id) || p.pair_product_id === p.id)))
    throw new AppError('INVALID_PRODUCT')
  if (p.fit_verified && (!p.photo_verified || !p.fit_visual_url ||
      p.fit_visual_url.startsWith('./assets/') ||
      !p.dimensions_cm?.trim() || !p.fits_inside_en?.trim() || !p.fits_inside_ar?.trim()))
    throw new AppError('INVALID_FIT_CLAIM')
  const translations = {};
  for (const [key, max] of [['name_ar',160],['description_ar',2000],['badge_ar',80]]) {
    if (Object.hasOwn(p, key)) {
      if (typeof p[key] !== 'string' || p[key].length > max) throw new AppError('INVALID_PRODUCT');
      translations[key] = p[key].trim();
    }
  }
  return {...translations, ...Object.fromEntries(
    [
      'id',
      'name',
      'description',
      'category',
      'price_minor',
      'stock_quantity',
      'active',
      'image',
      'badge',
      'swatches',
      ...['collections','gallery','fits_inside_en','fits_inside_ar','styling_en','styling_ar',
        'dimensions_cm','limited_edition','edition_size','photo_verified','pair_product_id',
        'fit_visual_url','fit_verified'].filter((k) => Object.hasOwn(p,k)),
    ].map((k) => [k, p[k]]),
  )}
}

export function imageExtension(bytes, type) {
  if (
    type === 'image/png' &&
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
  )
    return 'png'
  if (
    type === 'image/jpeg' &&
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'jpg'
  const ascii = new TextDecoder('ascii')
  if (
    type === 'image/webp' &&
    bytes.length >= 12 &&
    ascii.decode(bytes.slice(0, 4)) === 'RIFF' &&
    ascii.decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp'
  throw new AppError('INVALID_IMAGE')
}
