import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, '..', 'assets')
const sb = { window: {}, console }
sb.globalThis = sb.window
vm.createContext(sb)
vm.runInContext(fs.readFileSync(path.join(ASSETS, 'core.js'), 'utf8'), sb)
vm.runInContext(fs.readFileSync(path.join(ASSETS, 'sememe-data.js'), 'utf8'), sb)

const C = sb.window.PrimitiveCore
const CORE = sb.window.SEMEME_CORE
const t0 = Date.now()
const idx = C.buildIndex(CORE)
console.log('buildIndex', (Date.now() - t0) + 'ms', '| 英文词表', CORE.we ? Object.keys(CORE.we).length : 0)

const cases = [
  ['英文', 'The derivative of a function at a point is the slope of the tangent line. Differentiation and integration are inverse operations, and they form the foundation of calculus.'],
  ['中文', '导数的几何意义是函数图像在某一点切线的斜率。求导与积分互为逆运算，构成了微积分的基础。'],
  ['混合', '用 vector 表示这个矩阵的 rank，再计算它的 derivative 和 gradient。'],
  ['英文日常', 'I woke up early, made coffee, and walked to the station. The train was late again, so I read a book about memory and attention.']
]

for (const [name, text] of cases) {
  const tk = C.segment(text, idx)
  const oov = tk.filter((x) => x.oov).length
  const res = C.stream(tk, idx, { topK: 5 })
  const top = res.top.length ? res.sememes[res.top[0]][1] || res.sememes[res.top[0]][0] : '-'
  console.log(name.padEnd(6, ' '), 'token', String(tk.length).padStart(3), '未登录', String(oov).padStart(2),
    '(' + Math.round((oov / tk.length) * 100) + '%)', '点亮', String(res.top.length).padStart(2), 'top:', top)
}
