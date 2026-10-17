import fs from 'node:fs'
const team = process.env.APPLE_TEAM_ID
if (team) {
    if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid Apple Team ID')
    const source = fs.readFileSync('build/mac/entitlements.plist', 'utf8')
    const extra = `
    <key>com.apple.application-identifier</key>
    <string>${team}.org.tabby</string>
    <key>com.apple.developer.team-identifier</key>
    <string>${team}</string>
    <key>keychain-access-groups</key>
    <array><string>${team}.org.tabby</string></array>
`
    fs.writeFileSync('build/mac/touchid-entitlements.plist', source.replace('</dict>', `${extra}</dict>`))
}
if (process.env.MACOS_PROVISION_PROFILE) {
    fs.writeFileSync('build/mac/touchid.provisionprofile', Buffer.from(process.env.MACOS_PROVISION_PROFILE, 'base64'), { mode: 0o600 })
}
