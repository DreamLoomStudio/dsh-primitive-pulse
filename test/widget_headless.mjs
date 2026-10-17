/* 挂件无头冒烟：用最小 DOM/Canvas 桩把 widget.js 真跑一遍，
 * 检查「建 DOM → 载引擎 → 分析 → 重放几帧」这条链不抛错，并且真的画了东西。 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const ASSETS = path.join(ROOT, 'assets')
const WEB = path.join(ROOT, '..', '..', 'web')

const calls = { fillText: [], arc: 0, stroke: 0, fill: 0 }

function makeCtx() {
  const noop = () => {}
  return {
    canvas: null,
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, stroke: () => { calls.stroke++ }, fill: () => { calls.fill++ },
    arc: () => { calls.arc++ }, rect: noop, fillRect: noop, strokeRect: noop,
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    fillText: (t) => { calls.fillText.push(String(t)) },
    measureText: () => ({ width: 20 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    quadraticCurveTo: noop, bezierCurveTo: noop, setLineDash: noop,
    lineWidth: 1, strokeStyle: '', fillStyle: '', font: '', textAlign: '', shadowBlur: 0, shadowColor: ''
  }
}

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [],
    className: '', id: '', innerHTML: '', textContent: '', value: '', title: '',
    clientWidth: 380, clientHeight: 220,
    _attrs: {}, _listeners: {}, _ctx: null,
    setAttribute(k, v) { this._attrs[k] = v },
    getAttribute(k) { return this._attrs[k] },
    appendChild(c) { this.children.push(c); return c },
    removeChild() {}, remove() {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn) },
    removeEventListener() {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c) } else if (on) this._s.add(c); else this._s.delete(c) },
      contains(c) { return this._s.has(c) }
    },
    querySelector(sel) {
      this._q = this._q || {}
      if (!this._q[sel]) {
        this._q[sel] = makeEl(sel.includes('canvas') || sel === '#dsp-brain' || sel === '#dsp-eeg' ? 'canvas' : 'div')
        this._q[sel].id = sel.replace(/^[#.]/, '')
      }
      return this._q[sel]
    },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { left: 0, top: 0, width: 380, height: 220, right: 380, bottom: 220 } },
    getContext() { this._ctx = this._ctx || makeCtx(); this._ctx.canvas = this; return this._ctx }
  }
  return el
}

const body = makeEl('body')
const head = makeEl('head')
const byId = {}
const document = {
  readyState: 'complete',
  body, head,
  documentElement: makeEl('html'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ textContent: t }),
  getElementById: (id) => {
    if (id === 'dsp-brain' || id === 'dsp-eeg' || id === 'dsp-fp') {
      byId[id] = byId[id] || makeEl(id === 'dsp-fp' ? 'div' : 'canvas')
      byId[id].id = id
      if (id === 'dsp-fp' && !byId[id]._parented) {
        const panel = byId['__panel']
        if (panel) byId[id] = panel.querySelector('#dsp-fp')
        byId[id]._parented = true
      }
      return byId[id]
    }
    return null
  },
  querySelector: (s) => body.querySelector(s),
  addEventListener() {}
}

let rafQueue = []
const window = {
  document,
  devicePixelRatio: 2,
  _listeners: {},
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn) },
  removeEventListener(t, fn) {
    const a = this._listeners[t]
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
  },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length },
  performance: { now: () => Date.now() },
  innerWidth: 1440,
  innerHeight: 900,
  setInterval: () => 0,
  setTimeout: (fn) => { fn(); return 0 },
  getComputedStyle: () => ({ getPropertyValue: () => '' })
}

const sandbox = { window, document, console, Math, Date, JSON, Float32Array, Object, Array, String, Number, isNaN, parseFloat, parseInt }
sandbox.setInterval = () => 0
sandbox.setTimeout = (fn) => { fn(); return 0 }
sandbox.clearInterval = () => {}
sandbox.clearTimeout = () => {}
sandbox.requestAnimationFrame = (fn) => window.requestAnimationFrame(fn)
sandbox.performance = window.performance
sandbox.devicePixelRatio = 2
sandbox.globalThis = window
sandbox.self = window
vm.createContext(sandbox)

// 真实核心 + 真实词典（桩掉 document 就够，脚本本身是经典脚本）
// 仓库里自带 assets/ 副本，独立 clone 也能跑；开发树上则可回落到 ../web 的源
const hasBundled = fs.existsSync(path.join(ASSETS, 'core.js'))
const CORE = hasBundled ? path.join(ASSETS, 'core.js') : path.join(WEB, 'js', 'core.js')
const DATA = hasBundled ? path.join(ASSETS, 'sememe-data.js') : path.join(WEB, 'data', 'sememe-data.js')
vm.runInContext(fs.readFileSync(CORE, 'utf8'), sandbox)
vm.runInContext(fs.readFileSync(DATA, 'utf8'), sandbox)

const SAMPLE = '导数的几何意义是函数图像在某一点切线的斜率。当自变量的增量趋近于零时，函数的增量与自变量增量之比的极限，就是这一点的导数。'
sandbox.fetch = () => Promise.resolve({ json: () => Promise.resolve({ seq: 1, text: SAMPLE, ts: Date.now(), complete: true, turn: 1 }) })

vm.runInContext(fs.readFileSync(path.join(ASSETS, 'widget.js'), 'utf8'), sandbox)

const btn = body.children.find((c) => c.id === 'dsh-pulse-btn')
const panel = body.children.find((c) => c.id === 'dsh-pulse-panel')
if (!btn) throw new Error('按钮没建出来')
if (!panel) throw new Error('面板没建出来')

// 圆钮：mousedown → window mouseup（没拖动就是点击）→ 开面板
btn._listeners.mousedown[0]({ clientX: 5, clientY: 5, preventDefault() {} })
for (const fn of window._listeners.mouseup || []) fn({})
const q = panel._q || {}
byId['dsp-brain'] = q['#dsp-brain']
byId['dsp-eeg'] = q['#dsp-eeg']
byId['dsp-fp'] = panel.querySelector('#dsp-fp')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(500)

// 跑若干帧重放
for (let i = 0; i < 12; i++) {
  const qq = rafQueue.splice(0, rafQueue.length)
  for (const fn of qq) fn(performance.now() + i * 40)
  await wait(35)
}

const foot = (q['#dsp-foot'] || {}).textContent || ''
const cap = (q['#dsp-cap'] || {}).textContent || ''
const fp = (q['#dsp-fp'] || {}).innerHTML || ''

console.log('底部状态:', foot)
console.log('说明      :', cap.slice(0, 60))
console.log('指纹 HTML :', fp.slice(0, 90).replace(/\n/g, ' '))
console.log('绘制调用  : arc', calls.arc, 'stroke', calls.stroke, 'fill', calls.fill, 'fillText', calls.fillText.length)
console.log('导联标签  :', calls.fillText.slice(0, 8).join(' / '))

// 构建期异常守卫：build 抛错时球/面板会变成死物，这里直接判失败
if (sandbox.__dshPulseErr) throw new Error('挂件构建期异常：' + sandbox.__dshPulseErr)

const ok = calls.arc > 300 && calls.stroke > 0 && fp.includes('dsp-fp')
if (!ok) throw new Error('挂件没有真的画东西')
console.log('WIDGET OK')
