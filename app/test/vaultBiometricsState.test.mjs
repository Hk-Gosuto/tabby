import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require(process.env.TABBY_TEST_TYPESCRIPT || 'typescript')
const source = readFileSync(new URL('../../tabby-core/src/services/vaultBiometrics.service.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
})

function harness (state = {}, overrides = {}) {
    const calls = []
    const storage = { vaultBiometrics: JSON.stringify(state) }
    const module = { exports: {} }
    const platform = {
        isBiometricAuthAvailable: async () => true,
        storeBiometricPassphrase: async (...args) => { calls.push(['store', ...args]) },
        unlockBiometricPassphrase: async () => 'synthetic-secret',
        forgetBiometricPassphrase: async () => { calls.push(['forget']) },
        ...overrides,
    }
    vm.runInNewContext(outputText, {
        exports: module.exports, module, window: { localStorage: storage },
        console: { warn: () => {} },
        require: name => {
            if (name === '@angular/core') return { Injectable: () => x => x }
            if (name === '../api/platform') return { PlatformService: class {} }
            return require(name)
        },
    })
    return { service: new module.exports.VaultBiometricsService(platform), calls,
        state: () => JSON.parse(storage.vaultBiometrics), storage }
}

test('legacy cache is removed without decrypting or enrolling it', () => {
    const h = harness({ enabled: true, passphrase: { encrypted: 'old-synthetic-ciphertext' } })
    assert.equal(h.service.canUnlock(), false)
    assert.equal(h.state().passphrase, undefined)
    assert.equal(h.calls.length, 0)
})

test('enrollment stores secrets only through the protected platform API', async () => {
    const h = harness({ expireDays: 2, expireOnRestart: true })
    await h.service.enable('synthetic-secret')
    assert.deepEqual(h.calls, [['store', 'synthetic-secret', 2, true]])
    assert.equal(h.state().passphrase.version, 2)
    assert.equal(JSON.stringify(h.state()).includes('synthetic-secret'), false)
    assert.equal(h.service.canUnlock(), true)
})

test('failed enrollment does not enable the feature', async () => {
    const h = harness({}, { storeBiometricPassphrase: async () => { throw new Error('SIGNING_REQUIRED') } })
    await assert.rejects(h.service.enable('synthetic-secret'), /SIGNING_REQUIRED/)
    assert.equal(h.service.getSettings().enabled, false)
    assert.equal(h.service.canUnlock(), false)
})

test('changing policy invalidates the native cache and UI marker', async () => {
    const h = harness()
    await h.service.enable('synthetic-secret')
    await h.service.setExpiry(30, true)
    assert.deepEqual(h.calls.at(-1), ['forget'])
    assert.equal(h.service.canUnlock(), false)
    assert.equal(h.service.getSettings().expireDays, 30)
})

test('cancelled biometric read never returns a passphrase or discards a valid cache', async () => {
    const h = harness({}, { unlockBiometricPassphrase: async () => { throw new Error('cancelled') } })
    await h.service.enable('synthetic-secret')
    await assert.rejects(h.service.unlock(), /cancelled/)
    assert.equal(h.service.canUnlock(), true)
})

test('cache refresh failure does not make a correct master passphrase fail', async () => {
    const h = harness({ enabled: true }, {
        storeBiometricPassphrase: async () => { throw new Error('unavailable') },
        forgetBiometricPassphrase: async () => { throw new Error('unavailable') },
    })
    await h.service.storePassphrase('synthetic-secret')
    assert.equal(h.service.canUnlock(), false)
})

test('failed deletion is surfaced without falsely reporting the feature disabled', async () => {
    const h = harness({ enabled: true }, { forgetBiometricPassphrase: async () => { throw new Error('unavailable') } })
    await assert.rejects(h.service.disable(), /unavailable/)
    assert.equal(h.service.getSettings().enabled, true)
})

test('invalid saved state does not crash the unlock dialog', () => {
    for (const state of [null, [], '', { passphrase: 'malformed' }, { passphrase: 42 }]) {
        assert.equal(harness(state).service.canUnlock(), false)
    }
})
