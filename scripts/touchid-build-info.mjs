import fs from 'node:fs'
const info = `Tabby experimental build
Commit: ${process.env.GITHUB_SHA || 'local'}
Architecture: ${process.env.ARCH || process.arch}
Version: ${process.env.TABBY_VERSION || 'development'}
Developer ID signing configured: ${process.env.APPLE_TEAM_ID ? 'yes (verify the installed app signature and entitlements)' : 'no'}

This is a community fork, not an official Tabby release.
No Apple signing secrets are included in artifacts.
Ad-hoc test builds do not enable Hardened Runtime or establish publisher identity.
The backend uses the ordinary file-based Keychain. No Data Protection Keychain
access-group entitlements are required. Native code verifies Touch ID before
reading, but the ordinary item itself has no biometric ACL. Authorized app code
may bypass that application policy. macOS may request Keychain permission after
an ad-hoc app update. No safeStorage cache or renderer-held ciphertext is used.
CI checks native loading and denial without authorization, not real Touch ID.
See docs/macos-touchid-security.md for signing and physical-device validation.
`
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/TOUCHID-BUILD-INFO.txt', info)
