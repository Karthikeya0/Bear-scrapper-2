import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
const dir = process.argv[2]
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('file://' + dir + '/onepager.html', { waitUntil: 'load' }); await p.waitForTimeout(400)
await p.pdf({ path: dir + '/Bear-Studios-How-We-Work.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true })
await b.close(); console.log('ok')
