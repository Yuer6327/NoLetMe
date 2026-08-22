/**
 * Headless-browser smoke test for the NoLetMe plugin via Chrome DevTools
 * Protocol. Launches Edge (already running with --remote-debugging-port),
 * opens the dsh web app, waits for React to mount, and asserts the NoLetMe
 * panel text is present. Also surfaces any page console errors.
 *
 * Usage: node verify-browser.mjs <app-url>
 */

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:3080/'
const DEBUG = process.env.CDP_PORT ? 'http://127.0.0.1:' + process.env.CDP_PORT : 'http://127.0.0.1:9222'

/** Minimal CDP client over a WebSocket. */
class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [] }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('ws connect failed: ' + url))
    })
    return new CdpClient(ws)
  }
  on(handler) { this.handler = handler }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  listen() {
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      } else if (this.handler) {
        this.handler(msg)
      }
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  // Find an available page target (or create one).
  const version = await (await fetch(`${DEBUG}/json/version`)).json()
  console.log('browser:', version.Browser)

  let targets = await (await fetch(`${DEBUG}/json/list`)).json()
  const appOrigin = new URL(APP_URL).origin
  let target = targets.find(t => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(appOrigin))
  if (!target) {
    const created = await fetch(`${DEBUG}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })
    target = await created.json()
  }
  console.log('cdp target:', target.url)

  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
  cdp.listen()

  const consoleErrors = []
  const hostNoise = /syncing inspect providers failed|reading the Cordis inventory failed|Failed to fetch/
  const isPluginNoise = (text) => hostNoise.test(text) && !/noletme|NoLetMe/i.test(text)
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      const text = `EXCEPTION: ${d.exception?.description ?? d.text}`
      if (!isPluginNoise(text)) consoleErrors.push(text)
      else console.log('ignored host noise:', text.split('\n')[0])
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = `CONSOLE.ERROR: ${msg.params.args?.map(a => a.value ?? a.description ?? '').join(' ')}`
      if (!isPluginNoise(text)) consoleErrors.push(text)
      else console.log('ignored host noise:', text.split('\n')[0])
    }
  })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: APP_URL })

  // Poll for the panel or the app's failure surface.
  let body = ''
  let deadline = Date.now() + 45000
  let foundPanel = false
  while (Date.now() < deadline) {
    await sleep(1500)
    const res = await cdp.send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    })
    body = res.result?.value ?? ''
    if (/NoLetMe|推理轨迹/.test(body)) { foundPanel = true; break }
  }

  console.log('--- page text (first 1500 chars) ---')
  console.log(body.slice(0, 1500))
  console.log('---')
  console.log('panel rendered:', foundPanel)
  console.log('page console errors:', consoleErrors.length)
  for (const err of consoleErrors.slice(0, 10)) console.log(err)

  process.exit(foundPanel && consoleErrors.length === 0 ? 0 : 2)
}

main().catch((err) => {
  console.error('browser verification failed:', err.message)
  process.exit(3)
})
