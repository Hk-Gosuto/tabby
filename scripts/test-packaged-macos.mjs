import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('Packaged app startup checks require macOS')
const bundles = fs.readdirSync('dist', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join('dist', entry.name, 'Tabby.app'))
    .filter(bundle => fs.existsSync(bundle))
if (bundles.length !== 1) throw new Error('Expected exactly one packaged macOS app')
const executable = path.resolve(bundles[0], 'Contents/MacOS/Tabby')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-startup-'))
try {
    const config = path.join(temporary, 'config')
    fs.mkdirSync(config)
    const result = spawnSync(executable, ['--version'], {
        encoding: 'utf8',
        timeout: 60000,
        cwd: temporary,
        env: { ...process.env, TABBY_CONFIG_DIRECTORY: config, TABBY_PLUGINS: '' },
    })
    if (result.error || result.status !== 0 || !result.stdout.includes(process.env.TABBY_VERSION)) {
        console.error(result.stdout)
        console.error(result.stderr)
        throw new Error('The packaged app did not start and report the expected version')
    }
    console.log('Packaged app startup succeeded:', result.stdout.trim())
} finally {
    fs.rmSync(temporary, { recursive: true, force: true })
}
