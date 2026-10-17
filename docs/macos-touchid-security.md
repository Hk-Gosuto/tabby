# Touch ID with the ordinary macOS Keychain

This community fork integrates Eugeny/tabby PR #10973. It uses the traditional
file-based Keychain (normally the user's login keychain), so the Touch ID feature
does not require Data Protection Keychain access-group entitlements or a
Developer ID certificate.

## Unlock flow and security boundary

- The master passphrase and expiry record are stored in an ordinary Keychain
  generic-password item. They are not stored in localStorage or a temporary file.
- The native main-process module performs a fresh biometric-only LocalAuthentication
  check before enrollment AND before each read. Cancellation or failure returns
  no passphrase. There is no OS-password fallback in that biometric check.
- This is **application-enforced Touch ID**, not a biometric ACL attached to the
  Keychain item. Other code authorized by the item's ordinary Keychain ACL may
  read it without our biometric check. Code executing as trusted Tabby code,
  malicious plugins, or a compromised process can bypass this application policy.
- The ordinary item's sensitive-operation ACL initially trusts only the creating
  app, using SecAccessCreate with a null trusted-app list. It does not allow all
  applications. macOS may display a separate Keychain permission/password prompt,
  especially after an ad-hoc-signed build changes identity during an upgrade.
- No general safeStorage encrypt/decrypt IPC exists. Vault IPC accepts only known
  Tabby main frames, validates bounded input, and serializes native operations.
- Native reads enforce expiry and optional boot-session invalidation. Same-boot
  monotonic uptime limits wall-clock rollback. This is application policy, not a
  trusted-time protocol against an administrator manipulating the machine.
- Fingerprint changes do not automatically invalidate an ordinary Keychain item.
  The next unlock still requires a currently enrolled fingerprint. This build
  makes no biometryCurrentSet invalidation guarantee.
- Secrets may remain in V8/Foundation memory after authorization. This feature
  does not protect an unlocked app against trusted malicious plugins.

The service identifier is org.tabby.vault.touchid.login.v1. Existing safeStorage
ciphertext is discarded without decrypting it. Previous Data Protection Keychain
items are not silently migrated or read. Enter the master passphrase to enroll
this new ordinary Keychain item; an older protected item may be removed manually
using Keychain Access if desired.

## Compatibility and distribution

Application name (Tabby), bundle ID (org.tabby), URL scheme, configuration/plugin
directories, and updater behavior retain upstream defaults. Back up the existing
configuration before installing.

Actions builds macOS arm64/x86_64, Windows x64/arm64, and Linux x64/arm64/armv7l.
Successful packages, build information, and SHA-256 checksums are attached to a
prerelease after all build jobs pass.

Without signing secrets macOS packages use ad-hoc signing with Hardened Runtime
disabled for native-module compatibility. They do not establish publisher identity
and are not notarized. Optional Developer ID signing uses CSC_LINK and
CSC_KEY_PASSWORD; optional notarization also uses APPLE_TEAM_ID,
APPSTORE_USERNAME and APPSTORE_PASSWORD. There is no Touch-ID-specific provisioning
profile or Keychain access-group requirement for this ordinary-Keychain backend.

## Validation and limitations

CI checks native compilation/loading on both Mac architectures, no-UI enrollment
and read denial, IPC rejection and serialization, cache metadata and failure
handling, expiry policy, existing tests, declarations, lint, and packaged Mac
startup/version output. CI cannot supply a real finger or prove positive-path
Touch ID behavior.

On a physical Mac, test with disposable credentials:

1. Enable Touch ID, enter the correct master passphrase, and complete enrollment.
2. Restart Tabby, unlock through Touch ID, and cancel another attempt; verify the
   manual master passphrase remains usable.
3. Change expiry settings and master passphrase; verify stale cache is not used.
4. Test reboot expiry and disable Touch ID; verify the ordinary cache is removed.
5. After upgrading an ad-hoc build, review any macOS Keychain authorization prompt.
   Do not change the item to allow all applications.

References:
- https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
- https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:)
- https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)
