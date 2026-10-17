import type { IpcMain, IpcMainInvokeEvent } from 'electron'

export interface ProtectedVaultBinding {
    request (operation: string, input: string): Promise<string>
}

/** Only the main frame of a known Tabby window may request a vault operation. */
export function registerVaultBiometrics (
    ipc: Pick<IpcMain, 'handle'>,
    isTrustedWindow: (event: IpcMainInvokeEvent) => boolean,
    getBinding: () => ProtectedVaultBinding,
): void {
    let busy = false
    const handle = (operation: string, input: any): Promise<any> => {
        if (busy) {
            return Promise.reject(new Error('A protected vault operation is already in progress'))
        }
        busy = true
        return Promise.resolve().then(async () => {
            const result = await getBinding().request(operation, JSON.stringify(input))
            return JSON.parse(result)
        }).finally(() => { busy = false })
    }
    for (const operation of ['available', 'store', 'unlock', 'forget']) {
        ipc.handle(`app:vault-biometric-${operation}`, async (event, input) => {
            if (event.senderFrame !== event.sender.mainFrame || !isTrustedWindow(event)) {
                throw new Error('Untrusted vault request')
            }
            if (operation === 'store') {
                if (!input || typeof input.passphrase !== 'string' || !input.passphrase.length ||
                    input.passphrase.length > 16384 || !Number.isInteger(input.expireDays) ||
                    input.expireDays < 1 || input.expireDays > 30 || typeof input.expireOnRestart !== 'boolean') {
                    throw new Error('Invalid protected vault request')
                }
                // Do not forward unknown fields or caller-selected item identifiers.
                input = { passphrase: input.passphrase, expireDays: input.expireDays, expireOnRestart: input.expireOnRestart }
            } else {
                input = null
            }
            return handle(operation, input)
        })
    }
}
