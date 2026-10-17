# Experimental Touch ID fork

This fork integrates Eugeny/tabby PR #10973 (head `9826482`) onto upstream
`467ce8e`, replacing its independent Touch ID prompt + safeStorage decryption
with a native, OS-enforced Keychain read. It is not an official Tabby release
or a completed independent security audit.

## Security changes

- The native N-API module stores the master passphrase directly in the macOS
  Data Protection Keychain. Its ACL uses `biometryCurrentSet` with
  `WhenUnlockedThisDeviceOnly`; it does not synchronize to iCloud.
- Every read uses a new LAContext with biometric reuse disabled. Adding or
  removing fingerprints invalidates access. There is no OS-password fallback;
  the original Tabby master-passphrase dialog remains available.
- Removed the general safeStorage encrypt/decrypt IPC endpoints. Direct calls
  to the native unlock endpoint still require OS biometric authorization.
- Expiration policy and the boot-session identifier are inside the protected
  item. The native reader checks them before returning the passphrase. A
  monotonic uptime check prevents wall-clock rollback from extending the cache
  in the same boot session. This is not a trusted-time protocol against an
  administrator manipulating time across restarts.
- Renderer localStorage contains UI metadata only. Old safeStorage ciphertext
  is discarded without attempting to decrypt it. Changing expiration policy
  invalidates the native cache and requires re-enrollment.
- IPC is restricted to known Tabby main frames and serialized to avoid
  overlapping biometric operations. Inputs are bounded and item identifiers
  cannot be selected by the caller. No passphrase is sent as a command argument,
  written to a temporary file, logged, or included in build artifacts.

Tabby's plugins execute trusted application code. Once the user authorizes a
read, or types the master passphrase, that process receives plaintext; this
change does not isolate secrets from malicious plugins in an unlocked app.
V8/Foundation may retain copies in memory until garbage collection. Expired or
disabled caches cannot revoke old backups that already contain secrets.

## Builds and signing

The build retains upstream's application name (`Tabby`), bundle ID (`org.tabby`),
URL scheme, configuration/plugin directories and automatic updater behavior.
It uses the existing Tabby configuration. Back it up before installing this build.

The workflow builds macOS arm64/x86_64, Windows x64/arm64, and Linux
x64/arm64/armv7l using upstream's package pipeline. It publishes a prerelease
with the resulting assets and SHA-256 checksums only after every build succeeds.

Without signing secrets the workflow uses ad-hoc signing and disables Hardened
Runtime for that experimental package, so Electron/native modules can load
without claiming a Developer ID identity. A signed build enables Hardened
Runtime. Bundle signatures and the packaged native module are checked before
creating the DMG/ZIP.

An ad-hoc/unsigned macOS package is **not sufficient to guarantee Data Protection
Keychain access**. Native Keychain failure never falls back to weaker storage.
The master passphrase continues to work. To enable protected Touch ID, supply
valid Apple signing material as repository Actions secrets:

- `CSC_LINK`: base64 PKCS#12 signing certificate (private key included).
- `CSC_KEY_PASSWORD`: its password.
- `APPLE_TEAM_ID`: the matching ten-character team ID.
- `MACOS_PROVISION_PROFILE`: base64 provisioning profile authorizing
  `<TEAM_ID>.org.tabby` and the matching Keychain access group,
  when required by that signing identity.
- Optional notarization: `APPSTORE_USERNAME`, `APPSTORE_PASSWORD`.

Never paste signing credentials into an issue or chat, or commit them.
Verify that the signed executable has the expected application identifier,
team identifier, Keychain group and valid provisioning before use. Different
Apple identities/profiles may require adjusting the application identifier;
the current helper deliberately uses one fixed ID.

```sh
codesign --verify --deep --strict '/Applications/Tabby.app'
codesign -d --entitlements :- '/Applications/Tabby.app'
```

## Validation

Automated checks cover untrusted-frame rejection, invalid enrollment requests,
direct-IPC OS-denial propagation, serialization, expiry, wall-clock rollback and
boot changes. macOS CI additionally compiles/loads the module and verifies that
a read without UI cannot return a secret on a clean runner. This does **not**
prove successful biometric access or all ACL behavior on real hardware.

Before using important credentials, validate on a signed build and a physical Mac:

1. Enable a test vault using a disposable master passphrase and enroll Touch ID.
2. Restart Tabby and confirm Touch ID unlock works; cancel it and confirm the
   vault remains locked and manual passphrase entry still works.
3. Forget Tabby's in-memory passphrase and call the unlock endpoint directly;
   confirm it still needs Touch ID. For a stronger native check, use a fresh
   no-UI native read against an existing protected item and expect denial.
4. Change fingerprints, expiry settings and the master passphrase; verify that
   stale cached access is rejected. Test both boot-expiry settings.
5. Disable Touch ID and confirm the native item is removed. Verify a build
   lacking signing/entitlements cannot silently store or return the passphrase.

Apple references:
- https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
- https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain
- https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/biometrycurrentset
- https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps
