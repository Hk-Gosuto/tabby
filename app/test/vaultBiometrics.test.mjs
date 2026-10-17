import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require(process.env.TABBY_TEST_TYPESCRIPT || 'typescript')

const source = readFileSync(new URL('../lib/vaultBiometrics.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
const { registerVaultBiometrics } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

function harness (request = async () => 'null') {
    const handlers = new Map()
    const mainFrame = {}
    const sender = { mainFrame }
    const event = { sender, senderFrame: mainFrame }
    registerVaultBiometrics({ handle: (key, callback) => handlers.set(key, callback) },
        e => e.sender === sender, () => ({ request }))
    return { handlers, event, invoke: (op, input, e = event) => handlers.get(`app:vault-biometric-${op}`)(e, input) }
}

test('rejects untrusted windows and subframes before reaching the Keychain', async () => {
    let calls = 0
    const h = harness(async () => { calls++; return 'null' })
    await assert.rejects(h.invoke('unlock', null, { ...h.event, senderFrame: {} }), /Untrusted/)
    const otherFrame = {}
    await assert.rejects(h.invoke('unlock', null, { sender: { mainFrame: otherFrame }, senderFrame: otherFrame }), /Untrusted/)
    assert.equal(calls, 0)
})

test('direct unlock propagates OS authentication refusal; no fallback returns the secret', async () => {
    const h = harness(async () => { throw new Error('AUTH_REQUIRED') })
    await assert.rejects(h.invoke('unlock', { authenticated: true, skipTouchId: true }), /AUTH_REQUIRED/)
})

test('renderer cannot choose an item, expiry, or authentication context on unlock', async () => {
    const requests = []
    const h = harness(async (...args) => { requests.push(args); return '"synthetic-secret"' })
    assert.equal(await h.invoke('unlock', { item: 'other', expiresAt: Infinity, authenticated: true }), 'synthetic-secret')
    assert.deepEqual(requests, [['unlock', 'null']])
    assert.equal(h.handlers.has('app:safe-storage-decrypt'), false)
})

test('validates enrollment and never forwards unknown fields', async () => {
    const requests = []
    const h = harness(async (...args) => { requests.push(args); return 'null' })
    for (const expireDays of [0, 31, 1.5, Infinity, '1']) {
        await assert.rejects(h.invoke('store', { passphrase: 'synthetic', expireDays, expireOnRestart: true }), /Invalid/)
    }
    await assert.rejects(h.invoke('store', { passphrase: '', expireDays: 1, expireOnRestart: false }), /Invalid/)
    assert.equal(requests.length, 0)
    await h.invoke('store', { passphrase: 'synthetic', expireDays: 1, expireOnRestart: true, accessControl: 'none' })
    assert.deepEqual(JSON.parse(requests[0][1]), { passphrase: 'synthetic', expireDays: 1, expireOnRestart: true })
})

test('serializes authentication and releases the lock after a native error', async () => {
    let reject
    const h = harness(() => new Promise((_, r) => { reject = r }))
    const first = h.invoke('unlock')
    await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(h.invoke('unlock'), /already in progress/)
    reject(new Error('cancelled'))
    await assert.rejects(first, /cancelled/)
    const next = h.invoke('unlock')
    await new Promise(resolve => setImmediate(resolve))
    reject(new Error('cancelled again'))
    await assert.rejects(next, /cancelled again/)
})
