import * as path from 'path'
import * as fs from 'fs'
import * as electron from 'electron'

// This fork must not modify the official app's profiles or load its plugins.
electron.app.setName('Tabby Touch ID')
electron.app.setPath('userData', path.join(electron.app.getPath('appData'), 'Tabby Touch ID'))

const appPath = path.dirname(electron.app.getPath('exe'))

const portableData = path.join(appPath, 'data')
if (fs.existsSync(portableData)) {
    console.log('reset user data to ' + portableData)
    electron.app.setPath('userData', portableData)
}
