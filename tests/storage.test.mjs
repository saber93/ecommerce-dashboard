import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { imageExtension } from '../supabase/functions/_shared/security.mjs'
test('storage migration sets media limits and refuses to overwrite existing bucket settings', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      'create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);',
    )
    const sql = await readFile(
      new URL(
        '../supabase/migrations/20260924064030_product_images.sql',
        import.meta.url,
      ),
      'utf8',
    )
    await db.exec(sql)
    await db.exec(sql)
    const bucket = (await db.query('select * from storage.buckets')).rows[0]
    assert.equal(Number(bucket.file_size_limit), 5242880)
    await db.exec('update storage.buckets set public=false')
    await assert.rejects(db.exec(sql), /needs review/)
  } finally {
    await db.close()
  }
})
test('image content signature must match an allowed MIME type; SVG is rejected', () => {
  assert.equal(
    imageExtension(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'image/png',
    ),
    'png',
  )
  assert.throws(() =>
    imageExtension(
      new TextEncoder().encode('<svg onload="alert(1)">'),
      'image/svg+xml',
    ),
  )
  assert.throws(() =>
    imageExtension(new TextEncoder().encode('<html>'), 'image/png'),
  )
})
