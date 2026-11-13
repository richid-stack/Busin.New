import { spawn } from 'node:child_process'
import path from 'node:path'
import { startBridgeTestServer } from '../tests/helpers/bridgeTestServer.mts'

// Starts a stand-in OpenLobs, gets a pairing code, and runs the PowerShell script that clicks through the real installer.
const server = await startBridgeTestServer()
try {
  const pairing = await server.store.createPairing('winuser')
  const out = path.resolve('shots')
  const code = await new Promise<number>(resolve => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/win-shots.ps1', '-Installer', path.resolve('dist/OpenLobs-Bridge-Setup.exe'), '-Server', server.url, '-Code', pairing.code, '-Out', out], { stdio: 'inherit' })
    ps.on('exit', c => resolve(c ?? 1))
  })
  const devices = await server.store.listDevices('winuser')
  console.log(`exit ${code}; computers paired with the stand-in: ${devices.length}`)
} finally {
  await server.stop()
}
