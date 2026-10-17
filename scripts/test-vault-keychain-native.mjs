import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') throw new Error('Native Keychain checks require macOS')
const require = createRequire(import.meta.url)
const binding = require('../app/native/vault-keychain.node')
assert.equal(typeof JSON.parse(await binding.request('available', 'null')), 'boolean')
await assert.rejects(binding.request('unsupported', 'null'), /Unknown vault operation/)
await assert.rejects(binding.request('store', JSON.stringify({ passphrase: '' })), /Invalid/)
// CI has no enrolled fingerprint or cache. Never invoke enrollment or use real secrets.
await assert.rejects(binding.request('unlock', 'null', true), error =>
    ['AUTH_REQUIRED', 'CACHE_MISSING', 'SIGNING_REQUIRED', 'KEYCHAIN_ERROR'].includes(error.code))
console.log('Native module loaded; unauthenticated no-UI read failed closed. Hardware Touch ID is NOT tested.')
