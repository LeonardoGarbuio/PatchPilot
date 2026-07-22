import type { FastifyPluginAsync } from 'fastify'
import { execSync } from 'child_process'

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/system/pick-folder', async (req, reply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    try {
      let path = ''
      
      if (process.platform === 'win32') {
        const command = `powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.windows.forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`
        path = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
      } else if (process.platform === 'darwin') {
        const command = `osascript -e 'tell application "System Events" to return POSIX path of (choose folder)'`
        path = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
      } else if (process.platform === 'linux') {
        const command = `zenity --file-selection --directory`
        path = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
      } else {
        return reply.status(400).send({ error: 'Unsupported OS for folder picker' })
      }

      if (!path) {
        return reply.status(200).send({ path: null })
      }

      return reply.status(200).send({ path })
    } catch (err) {
      // User likely cancelled the dialog or it failed
      app.log.warn(`Folder picker failed or was cancelled: ${String(err)}`)
      return reply.status(200).send({ path: null })
    }
  })
}
