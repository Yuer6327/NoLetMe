/**
 * Morph-interaction smoke test: drives the NoLetMe panel in a headless Edge
 * via CDP. Navigates, waits for the panel, reads its box, collapses it (click
 * the header chevron), reads the pill box, re-expands (click the pill), reads
 * the card box again, and screenshots both shapes. Reports console errors.
 *
 * Usage: node verify-morph.mjs <app-url>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:3100/'
const DEBUG = process.env.CDP_PORT ? 'http://127.0.0.1:' + process.env.CDP_PORT : 'http://127.0.0.1:9223'

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handler = null }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')) })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  listen() {
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== undefined) {
        const p = this.pending.get(m.id)
        if (!p) return
        this.pending.delete(m.id)
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
      } else if (this.handler) this.handler(m)
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const list = await (await fetch(`${DEBUG}/json/list`)).json()
  const appOrigin = new URL(APP_URL).origin
  let target = list.find(t => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(appOrigin))
  if (!target) {
    target = await (await fetch(`${DEBUG}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })).json()
  }
  console.log('cdp target:', target.url)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  cdp.listen()

  const errors = []
  const hostNoise = /syncing inspect providers failed|reading the Cordis inventory failed|Failed to fetch/
  cdp.handler = (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const text = m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text
      if (hostNoise.test(text) && !/noletme|NoLetMe/i.test(text)) return
      errors.push(text)
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ')
      if (hostNoise.test(text) && !/noletme|NoLetMe/i.test(text)) return
      errors.push(text || 'console.error')
    }
  }

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: APP_URL })

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }

  // Wait for the panel root (has NoLetMe text).
  let box = null
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    await sleep(1200)
    box = await evalJs(`(() => {
      const pill = document.querySelector('button[title*="NoLetMe"]');
      const root = pill && pill.parentElement;
      if (!root) return null;
      const r = root.getBoundingClientRect();
      const pillBtn = pill;
      return { w: Math.round(r.width), h: Math.round(r.height), pillVisible: getComputedStyle(pillBtn).visibility, text: document.body.innerText.slice(0, 200) };
    })()`)
    if (box) break
  }
  if (!box) { console.log('PANEL NOT FOUND. page text:', (await evalJs('document.body.innerText')).slice(0, 300)); process.exit(2) }

  console.log('initial (persisted-open) root box:', JSON.stringify(box))

  // Collapse: click the header chevron (aria-label 收起 / Collapse).
  await evalJs(`(() => {
    const b = document.querySelector('button[aria-label="收起"], button[aria-label="Collapse"]');
    if (b) b.click();
    return !!b;
  })()`)
  await sleep(800)
  const pillBox = await evalJs(`(() => {
    const pill = document.querySelector('button[title*="NoLetMe"]');
    if (!pill) return null;
    const root = pill.parentElement;
    const r = root.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), pillVis: getComputedStyle(pill).visibility, pillOpacity: getComputedStyle(pill).opacity, radius: getComputedStyle(root).borderRadius };
  })()`)
  console.log('collapsed chip root box:', JSON.stringify(pillBox))
  const shotDir = join(tmpdir(), 'noletme-verify')
  mkdirSync(shotDir, { recursive: true })
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r => { writeFileSync(join(shotDir, 'noletme-pill.png'), Buffer.from(r.data, 'base64')) })

  // Expand: click the pill.
  await evalJs(`(() => {
    const p = document.querySelector('button[title*="NoLetMe"]');
    if (p) p.click();
    return !!p;
  })()`)
  await sleep(800)
  const cardBox = await evalJs(`(() => {
    const pill = document.querySelector('button[title*="NoLetMe"]');
    const root = pill && pill.parentElement;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`)
  console.log('re-expanded card root box:', JSON.stringify(cardBox))
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r => { writeFileSync(join(shotDir, 'noletme-card.png'), Buffer.from(r.data, 'base64')) })

  const pillIsPill = pillBox && pillBox.w < 170 && pillBox.h <= 42
  const chipRoundedRect = pillBox && pillBox.radius !== '999px' && Number.parseInt(pillBox.radius, 10) < 30
  const cardIsCard = cardBox && cardBox.w >= 295 && cardBox.w <= 305
  console.log('chip shaped:', pillIsPill, '| chip is rounded-rect (radius', pillBox?.radius, '):', chipRoundedRect, '| card shaped:', cardIsCard)
  console.log('console errors:', errors.length)

  const ok = pillIsPill && chipRoundedRect && cardIsCard && errors.length === 0
  console.log(ok ? 'MORPH VERIFIED ✓' : 'MORPH CHECK FAILED ✗')
  process.exit(ok ? 0 : 2)
}

main().catch((e) => { console.error('fail:', e.message); process.exit(3) })
