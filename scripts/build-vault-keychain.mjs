#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('The protected Keychain module must be built on macOS')
const root = fileURLToPath(new URL('..', import.meta.url))
const arch = process.env.ARCH === 'x86_64' ? 'x86_64' : process.env.ARCH || process.arch
if (!['arm64', 'x86_64', 'x64'].includes(arch)) throw new Error('Unsupported macOS architecture')
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-node-headers-'))
try {
    // N-API is ABI-stable: no Electron internals or additional npm dependencies.
    const archive = path.join(cache, 'headers.tar.gz')
    execFileSync('curl', ['--fail', '--location', '--retry', '3', '--output', archive,
        `https://nodejs.org/download/release/${process.version}/node-${process.version}-headers.tar.gz`], { stdio: 'inherit' })
    execFileSync('tar', ['xzf', archive, '-C', cache])
    const include = path.join(cache, `node-${process.version}`, 'include/node')
    const target = path.join(root, 'app/native/vault-keychain.node')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-O2',
        '-Wall', '-Wextra', '-arch', arch === 'x64' ? 'x86_64' : arch,
        '-mmacosx-version-min=12.0', '-bundle', '-undefined', 'dynamic_lookup',
        '-DNODE_GYP_MODULE_NAME=vault_keychain', '-DNAPI_VERSION=8', '-I', include,
        '-framework', 'Foundation', '-framework', 'Security', '-framework', 'LocalAuthentication',
        path.join(root, 'native/vault-keychain/keychain.mm'), '-o', target], { stdio: 'inherit' })
    // Allows loading in arm64 test builds; distributed signed builds are re-signed by electron-builder.
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'inherit' })
} finally {
    fs.rmSync(cache, { recursive: true, force: true })
}
