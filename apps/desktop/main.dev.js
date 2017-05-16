/* eslint-disable global-require, no-console */

import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import windowStateKeeper from 'electron-window-state'
import _ from 'lodash'
import observe from 'observe'
import cp from 'child_process'
import ps from 'ps-node'
import fileLog from 'electron-log'
import os from 'os'
import lnd from './rpc-server'

global.connection = lnd.connection
global.serverReady = lnd.serverReady

app.commandLine.appendSwitch('remote-debugging-port', '9997')
app.commandLine.appendSwitch('host-rules', 'MAP * 127.0.0.1')

let mainWindow = null
const isDev = process.env.NODE_ENV === 'development'
const runningProcesses = []

const isProcessRunning = command => new Promise((resolve, reject) => {
  ps.lookup({ command },
    (err, resultList) => {
      if (err) { throw new Error(err) }
      resultList[0] ? resolve(resultList[0]) : reject()
    },
  )
})

const runProcesses = (processes, logs) => {
  _.map(processes, (proc) => {
    isProcessRunning(proc.name)
      .then(() => {
        console.log(`${ proc.name } Already Running`)
        logs.push(`${ proc.name } Already Running`)
        fileLog.info(`${ proc.name } Already Running`)
      })
      .catch(() => {
        const plat = os.platform()
        const filePath = path.join(__dirname, 'bin', plat, proc.name, plat === 'win32' ? '.exe' : '')

        try {
          const instance = cp.execFile(filePath, proc.args, { cwd: 'bin' }, (error) => {
            if (error) {
              logs.push(error.code ? `${ error.code }: ${ error.errno }` : JSON.stringify(error))
            }
          })
          runningProcesses.push(instance)
          instance.stdout.on('data', data => logs.push(`${ proc.name }: ${ data }`))
          instance.stderr.on('data', (data) => {
            logs.push(`${ proc.name } Error: ${ data }`)
            fileLog.error(`${ proc.name }: ${ data }`)
          })
        } catch (error) {
          console.log(`Caught Error When Starting ${ proc.name }: ${ error }`)
          logs.push(`Caught Error When Starting ${ proc.name }: ${ error }`)
        }
      })
  })
}

const logBuffer = []
const logs = observe(logBuffer)

const processes = [
  {
    name: 'lnd',
    args: [
      '--bitcoin.active',
      '--bitcoin.rpchost=localhost',
      '--bitcoin.rpcuser=kek',
      '--bitcoin.rpcpass=kek',
      isDev ? '--bitcoin.simnet' : '--bitcoin.testnet',
      '--debuglevel=debug',
      '--debughtlc',
    ],
  }, {
    name: 'btcd',
    args: [
      '--rpcuser=kek',
      '--rpcpass=kek',
      isDev ? '--simnet' : '--testnet',
      isDev ? '--miningaddr=4NyWssGkW6Nbwj3nXrJU54U2ijHgWaKZ1N19w' : '',
      '--txindex',
    ],
  },
]

runProcesses(processes, logs)

const createWindow = () => {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 750,
    defaultHeight: 500,
  })

  const { x, y, width, height } = mainWindowState
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    transparent: true,
    frame: false,
    title: 'Lightning',
  })

  mainWindowState.manage(mainWindow)
  if (isDev) {
    mainWindow.loadURL('http://localhost:4152')
  } else {
    mainWindow.loadURL(`file://${ __dirname }/app.html`)
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show()
    mainWindow.focus()

    mainWindow.webContents.send('logs', logBuffer)
  })

  let logQueue = []

  logs.on('change', (change) => {
    const log = logBuffer[change.index]
    logQueue.push(log)
  })

  setInterval(() => {
    try {
      logQueue.length && mainWindow.webContents.send('logs', logQueue)
      logQueue = []
    } catch (err) {
      console.log('WARNING: App Was Closed While Writing Logs')
    }
  }, 2000)

  // if (isDev) {
  //   mainWindow.openDevTools()
  // }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const template = [
    {
      label: 'Lightning',
      submenu: [
        { label: 'Quit', accelerator: 'Command+Q', click() { app.quit() } },
      ],
    }, {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:' },
      ],
    },
  ]

  !isDev && Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// if (isDev) {
require('electron-debug')({ enabled: true })
// }

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// if (process.platform === 'darwin') {
//   const template = [
//     {
//       label: app.getName(),
//     },
//   ]
//   const menu = Menu.buildFromTemplate(template)
//   Menu.setApplicationMenu(menu)
// }

app.on('ready', createWindow)

app.on('quit', () => {
  runningProcesses.forEach(proc => proc.kill())
})

process.on('uncaughtException', (error) => {
  console.log('Caught Main Process Error:', error)
  fileLog.error(`Main Process: ${ error }`)
})