Experimental community build based on Eugeny/tabby with PR #10973 integrated.

Changes:
- Replace the independent Touch ID prompt and safeStorage cache with a native
  Data Protection Keychain item protected by the current biometric set.
- Enforce cache expiration and optional reboot invalidation in the native reader.
- Remove generic decryption IPC; restrict and serialize biometric requests.
- Keep a separate `Tabby Touch ID` app and configuration directory.
- Build macOS, Windows and Linux packages using GitHub Actions, and attach all
  successful packages plus SHA-256 checksums to this prerelease.

macOS: choose `macos-arm64.dmg` for Apple Silicon or `macos-x86_64.dmg` for Intel.
Protected Touch ID requires valid Apple signing and Keychain entitlements.
Unsigned/ad-hoc builds retain manual master-passphrase access and must not be
assumed to support protected Touch ID. There is no weaker-storage fallback.
See the attached SECURITY-NOTES.md and MACOS-BUILD-INFO.txt.

CI compilation and regression tests do not replace physical-Mac biometric tests.
Use a backup/test configuration before importing important credentials.
Official Tabby automatic updates are disabled for this fork.
