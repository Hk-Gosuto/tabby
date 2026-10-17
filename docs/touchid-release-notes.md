Community Tabby build with PR #10973 and an ordinary macOS Keychain backend.

- Store the master passphrase in the ordinary login/default Keychain.
- Perform fresh Touch ID verification in native main-process code before reading.
- Keep IPC validation, serialization, expiry/reboot policy and manual unlock.
- Include Chinese translations for Touch ID settings and actionable error messages.
- Retain upstream app identity, data/plugin directories, URL scheme and updater.

Touch ID is enforced by this application's native code, not by a biometric ACL
on the ordinary Keychain item. Other authorized/trusted code may bypass that
application policy. Fingerprint changes do not invalidate the item automatically.

macOS: choose macos-arm64.dmg for Apple Silicon or macos-x86_64.dmg for Intel.
This backend does not require Developer ID or Data Protection Keychain entitlements.
Ad-hoc packages remain unnotarized and do not establish publisher identity.
macOS may request ordinary Keychain authorization after an app upgrade.

See SECURITY-NOTES.md, MACOS-BUILD-INFO.txt and SHA256SUMS.txt.
Physical-Mac Touch ID success is not validated by CI. Back up existing settings.
