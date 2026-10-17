import * as path from 'path'
import * as fs from 'fs'
import * as electron from 'electron'

// This fork must not modify the official app's profiles or load its plugins.
electron.app.setName('Tabby Touch ID')
const userDataPath = path.join(electron.app.getPath('appData'), 'Tabby Touch ID')
fs.mkdirSync(userDataPath, { recursive: true })
electron.app.setPath('userData', userDataPath)

const appPath = path.dirname(electron.app.getPath('exe'))

const portableData = path.join(appPath, 'data')
if (fs.existsSync(portableData)) {
    console.log('reset user data to ' + portableData)
    electron.app.setPath('userData', portableData)
}
