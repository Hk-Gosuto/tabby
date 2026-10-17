import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') throw new Error('Native Keychain checks require macOS')
const require = createRequire(import.meta.url)
const binding = require('../app/native/vault-keychain.node')
assert.equal(typeof JSON.parse(await binding.request('available', 'null')), 'boolean')
await assert.rejects(binding.request('unsupported', 'null'), /Unknown vault operation/)
await assert.rejects(binding.request('store', JSON.stringify({ passphrase: '' })), /Invalid/)
// CI has no enrolled fingerprint or cache. Never invoke enrollment or use real secrets.
await assert.rejects(binding.request('unlock', 'null', true), error => error.code === 'AUTH_REQUIRED')
await assert.rejects(binding.request('store', JSON.stringify({
    passphrase: 'synthetic-test-only', expireDays: 1, expireOnRestart: false,
}), true), error => error.code === 'AUTH_REQUIRED')
console.log('Native module loaded; unauthenticated no-UI read failed closed. Hardware Touch ID is NOT tested.')
