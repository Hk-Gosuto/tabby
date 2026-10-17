import * as os from 'os'
import { Injectable } from '@angular/core'
import { PlatformService } from '../api/platform'

export interface VaultBiometricsSettings {
    enabled: boolean
    /** Days after which the passphrase has to be entered again */
    expireDays: number
    /** Whether the passphrase has to be entered again after the computer restarts */
    expireOnRestart: boolean
}

interface StoredPassphrase {
    /** Metadata only. The passphrase and enforced expiry live in the protected Keychain item. */
    version: 2
    /** When the user entered the passphrase */
    enteredAt: number
    /** When the computer booted, as of {@link enteredAt} */
    bootTime: number
}

interface VaultBiometricsState extends VaultBiometricsSettings {
    passphrase?: StoredPassphrase
}

const STORAGE_KEY = 'vaultBiometrics'
const MAX_EXPIRE_DAYS = 30
const DAY = 24 * 60 * 60 * 1000
// Allows for clock adjustments - a restart moves the boot time much further
const BOOT_TIME_TOLERANCE = 60 * 1000

function getBootTime (): number {
    return Date.now() - os.uptime() * 1000
}

function clampExpireDays (days: number): number {
    return Math.max(1, Math.min(MAX_EXPIRE_DAYS, Math.floor(days || 1)))
}

/**
 * Keeps only cache metadata here; the passphrase is stored in a biometrically protected Keychain item,
 * until the passphrase has to be entered again
 */
@Injectable({ providedIn: 'root' })
export class VaultBiometricsService {
    /** @hidden */
    private constructor (
        private platform: PlatformService,
    ) { }

    async isAvailable (): Promise<boolean> {
        return this.platform.isBiometricAuthAvailable()
    }

    getSettings (): VaultBiometricsSettings {
        const { enabled, expireDays, expireOnRestart } = this.load()
        return { enabled, expireDays, expireOnRestart }
    }

    async setExpiry (expireDays: number, expireOnRestart: boolean): Promise<void> {
        // Policy changes invalidate the cache; editable UI metadata must never extend it.
        await this.forgetPassphrase()
        this.save({ ...this.load(), expireDays: clampExpireDays(expireDays), expireOnRestart })
    }

    /**
     * Whether the vault can be unlocked with Touch ID now. Discards the stored passphrase once it has expired.
     */
    canUnlock (): boolean {
        const state = this.load()
        if (!state.enabled || !state.passphrase) {
            return false
        }
        if (this.isExpired(state.passphrase, state)) {
            // UI hint only; native code independently enforces the protected expiry.
            this.save({ ...state, passphrase: undefined })
            return false
        }
        return true
    }

    /**
     * Asks for Touch ID and returns the stored passphrase
     */
    async unlock (): Promise<string> {
        if (!this.canUnlock()) {
            throw new Error('Touch ID unlock is not available')
        }
        try {
            return await this.platform.unlockBiometricPassphrase()
        } catch (error) {
            // Cancellation leaves a valid entry usable; native expiry and missing-item
            // errors require manual re-enrollment. No generic decryption fallback.
            if (/expired|enabled again/.test(error.message)) {
                await this.forgetPassphrase()
            }
            throw error
        }
    }

    /** Store a new item whose read access is enforced by the OS, not a JS prompt. */
    async enable (passphrase: string): Promise<void> {
        const settings = this.load()
        const stored = await this.storeProtectedPassphrase(passphrase)
        this.save({ ...settings, enabled: true, passphrase: stored })
    }

    async disable (): Promise<void> {
        if (this.load().enabled) {
            await this.platform.forgetBiometricPassphrase()
        }
        this.save({ ...this.load(), enabled: false, passphrase: undefined })
    }

    /**
     * Keeps a passphrase that the user has entered, which restarts the expiry period.
     * Does nothing unless Touch ID unlock is enabled.
     */
    async storePassphrase (passphrase: string): Promise<void> {
        if (!this.load().enabled) {
            return
        }
        const stored = await this.storeProtectedPassphrase(passphrase).catch(() => {
            // Discard the previous passphrase anyway, it may be outdated
            console.warn('Could not store the passphrase for Touch ID')
            return undefined
        })
        if (!stored) {
            try {
                await this.forgetPassphrase()
            } catch {
                // Cache errors must not prevent a correct master passphrase from
                // opening the vault. Do not claim native deletion succeeded.
                console.warn('Could not remove the previous protected vault cache')
            }
        }
        const state = this.load()
        // Touch ID unlock might have been disabled in the meantime
        if (state.enabled) {
            this.save({ ...state, passphrase: stored })
        }
    }

    /**
     * Discards the stored passphrase so that it has to be entered again
     */
    async forgetPassphrase (): Promise<void> {
        await this.platform.forgetBiometricPassphrase()
        this.save({ ...this.load(), passphrase: undefined })
    }

    private isExpired (passphrase: StoredPassphrase, settings: VaultBiometricsSettings): boolean {
        const age = Date.now() - passphrase.enteredAt
        if (age < 0 || age > settings.expireDays * DAY) {
            return true
        }
        return settings.expireOnRestart && Math.abs(getBootTime() - passphrase.bootTime) > BOOT_TIME_TOLERANCE
    }

    private async storeProtectedPassphrase (passphrase: string): Promise<StoredPassphrase> {
        const settings = this.load()
        await this.platform.storeBiometricPassphrase(passphrase, settings.expireDays, settings.expireOnRestart)
        return { version: 2, enteredAt: Date.now(), bootTime: getBootTime() }
    }

    private load (): VaultBiometricsState {
        let state: Partial<VaultBiometricsState> = {}
        try {
            const parsed = JSON.parse(window.localStorage[STORAGE_KEY] ?? '{}')
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                state = parsed
            }
        } catch { }
        // Never migrate the old safeStorage ciphertext by decrypting it silently.
        // Drop it and require the master passphrase to enroll a protected item.
        if (state.passphrase && (typeof state.passphrase !== 'object' || state.passphrase.version !== 2 || 'encrypted' in state.passphrase)) {
            state.passphrase = undefined
            window.localStorage[STORAGE_KEY] = JSON.stringify(state)
        }
        return {
            enabled: state.enabled ?? false,
            expireDays: clampExpireDays(state.expireDays ?? 1),
            expireOnRestart: state.expireOnRestart ?? false,
            passphrase: state.passphrase,
        }
    }

    private save (state: VaultBiometricsState): void {
        window.localStorage[STORAGE_KEY] = JSON.stringify(state)
    }
}
