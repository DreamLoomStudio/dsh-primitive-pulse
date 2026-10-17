/* 把上游 web/ 里的真实资产同步进插件（改完 core.js 或重建词表之后跑一次）。
   只在开发布局下有意义：web/ 与本包同级（monorepo）或通过 DSH_PULSE_WEB 指定。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const WEB = process.env.DSH_PULSE_WEB || path.join(ROOT, '..', '..', 'web')
const ASSETS = path.join(ROOT, 'assets')

if (!fs.existsSync(WEB)) {
  console.error(`找不到上游 web/ 目录：${WEB}`)
  console.error('独立仓库里不需要这一步——assets/ 已经是构建好的产物；')
  console.error('如果确实要从别处同步，设置环境变量 DSH_PULSE_WEB 指向那个 web 目录。')
  process.exit(1)
}

const pairs = [
  [path.join(WEB, 'js', 'core.js'), path.join(ASSETS, 'core.js')],
  [path.join(WEB, 'data', 'sememe-data.js'), path.join(ASSETS, 'sememe-data.js')]
]

for (const [from, to] of pairs) {
  const buf = fs.readFileSync(from)
  fs.writeFileSync(to, buf)
  console.log(path.basename(to), buf.length, 'bytes')
}
console.log('assets 已同步')
