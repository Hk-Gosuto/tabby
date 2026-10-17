#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Missing Actions secrets arrive as empty strings; electron-builder otherwise
// resolves an empty CSC_LINK to the repository directory and tries to import it.
if (!process.env.CSC_LINK?.trim()) {
    delete process.env.CSC_LINK
}

const isTag = (process.env.GITHUB_REF || '').startsWith('refs/tags/')

process.env.ARCH = process.env.ARCH || process.arch

if (process.env.GITHUB_HEAD_REF) {
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

process.env.APPLE_ID ??= process.env.APPSTORE_USERNAME
process.env.APPLE_APP_SPECIFIC_PASSWORD ??= process.env.APPSTORE_PASSWORD

builder({
    dir: true,
    mac: ['dmg', 'zip'],
    x64: process.env.ARCH === 'x86_64',
    arm64: process.env.ARCH === 'arm64',
    config: {
        afterSign: async context => {
            const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
            execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' })
            const native = path.join(bundle, 'Contents/Resources/app.asar.unpacked/native/vault-keychain.node')
            if (!fs.existsSync(native)) {
                throw new Error('The packaged app is missing its protected Keychain module')
            }
        },
        extraMetadata: {
            version: vars.version,
            teamId: process.env.APPLE_TEAM_ID,
        },
        forceCodeSigning: !!process.env.CSC_LINK,
        mac: {
            // Ad-hoc signatures keep test bundles internally valid on Apple Silicon.
            identity: process.env.CSC_LINK ? undefined : '-',
            hardenedRuntime: !!process.env.CSC_LINK,
            entitlements: 'build/mac/entitlements.plist',
            notarize: !!(process.env.APPLE_TEAM_ID && process.env.APPSTORE_USERNAME && process.env.APPSTORE_PASSWORD),
        },
        npmRebuild: process.env.ARCH !== 'arm64',
        publish: process.env.KEYGEN_TOKEN ? [
            vars.keygenConfig,
            {
                provider: 'github',
                channel: `latest-${process.env.ARCH}`,
            },
        ] : undefined,
    },
    publish: (process.env.KEYGEN_TOKEN && isTag) ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
