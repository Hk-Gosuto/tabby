import fs from 'node:fs'
const info = `Tabby experimental build
Commit: ${process.env.GITHUB_SHA || 'local'}
Architecture: ${process.env.ARCH || process.arch}
Version: ${process.env.TABBY_VERSION || 'development'}
Developer ID signing configured: ${process.env.APPLE_TEAM_ID ? 'yes (verify the installed app signature and entitlements)' : 'no'}

This is a community fork, not an official Tabby release.
No Apple signing secrets are included in artifacts.
Ad-hoc test builds do not enable Hardened Runtime or establish publisher identity.
Unsigned/ad-hoc builds can be used with the master passphrase. Protected Touch ID
requires valid Apple signing and Keychain entitlements; it fails closed if these
are unavailable. There is no fallback to safeStorage or an unprotected Keychain.
CI checks native loading and denial without authorization, not real Touch ID.
See docs/macos-touchid-security.md for signing and physical-device validation.
`
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/TOUCHID-BUILD-INFO.txt', info)
