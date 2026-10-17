/* 端到端冒烟：不开浏览器，直接跑「分词 → 义原流 → 簇帧 → 指纹」这条链。
 * 目的：确认挂件依赖的每个数据字段都真的存在、量级正常。 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, '..', 'assets')

const sandbox = { window: {}, console }
sandbox.globalThis = sandbox.window
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(ASSETS, 'core.js'), 'utf8'), sandbox)
vm.runInContext(fs.readFileSync(path.join(ASSETS, 'sememe-data.js'), 'utf8'), sandbox)

const C = sandbox.window.PrimitiveCore
const CORE = sandbox.window.SEMEME_CORE
if (!C) throw new Error('PrimitiveCore 未挂载')
if (!CORE) throw new Error('SEMEME_CORE 未挂载')

const need = ['s', 'w', 'p', 'g', 'gn', 'x', 'se', 'cl', 'cc', 'ce']
for (const k of need) {
  if (CORE[k] == null) throw new Error('缺字段 core.' + k)
}
const nCl = CORE.cc.length / 3
if (CORE.cl.length !== CORE.s.length) throw new Error('cl 长度与义原数不符')
if (nCl !== Math.max(...CORE.cl) + 1) throw new Error('簇数与 cl 最大值不符')

const t0 = Date.now()
const idx = C.buildIndex(CORE)
const t1 = Date.now()

const text = '导数的几何意义是切线斜率。对函数求导之后，我们得到一个变化的速率，它描述函数在某一点附近的变化快慢。'
const tokens = C.segment(text, idx)
const res = C.stream(tokens, idx, { topK: 8 })
const fp = C.fingerprint(res, idx)
const t2 = Date.now()

if (!res.series.length) throw new Error('series 为空')
if (res.series[0].length !== CORE.s.length) throw new Error('series 维度不对')
if (!res.top.length) throw new Error('没有任何义原被点亮')

// 簇帧（挂件的重放用的就是这条）
const step = Math.max(1, Math.floor(res.series.length / 220))
const frames = []
const cl = CORE.cl
for (let f = 0; f < res.series.length; f += step) {
  const fr = new Float32Array(nCl)
  const row = res.series[f]
  for (let i = 0; i < cl.length; i++) if (row[i] > 0) fr[cl[i]] += row[i]
  let mx = 0
  for (let k = 0; k < nCl; k++) if (fr[k] > mx) mx = fr[k]
  if (mx > 0) for (let k = 0; k < nCl; k++) fr[k] /= mx
  frames.push(fr)
}
let litClusters = 0
for (let k = 0; k < nCl; k++) {
  let any = false
  for (const fr of frames) if (fr[k] > 0.05) { any = true; break }
  if (any) litClusters++
}

// 导联（每个 top 义原一条曲线）
const chans = res.top.map((sid) => {
  const a = new Float32Array(res.series.length)
  for (let f = 0; f < res.series.length; f++) a[f] = res.series[f][sid] / (res.maxV || 1)
  return a
})
const peak = Math.max(...chans.map((a) => Math.max(...a)))

console.log('义原数        ', CORE.s.length)
console.log('词表          ', Object.keys(CORE.w).length)
console.log('簇数          ', nCl, '边', CORE.ce.length / 2)
console.log('buildIndex    ', (t1 - t0) + 'ms')
console.log('分析          ', (t2 - t1) + 'ms')
console.log('token/未登录  ', tokens.length, '/', res.stats ? res.stats.oovRate.toFixed(3) : '-')
console.log('点亮义原      ', res.top.length, 'top1 =', res.sememes[res.top[0]][1])
console.log('簇帧          ', frames.length, '帧；含激活的簇', litClusters, '/', nCl)
console.log('导联峰值      ', peak.toFixed(3), '(应 ≈1)')
console.log('最高分区      ', fp.regions[0].name, (fp.regions[0].share * 100).toFixed(0) + '%')
console.log('指纹项        ', fp.regions.length, '举例:', fp.regions.slice(0, 3).map((r) => r.name).join(' / '))
console.log('SMOKE OK')
