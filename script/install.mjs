/* 把插件注册进 DSH 的 web profile（幂等）：
 *   ① profile 的 cordis.patch.yml 追加插入行
 *   ② profile 的 package.json 追加 link: 依赖
 * 用 node 写文件，避免 PowerShell 对 UTF-8 的破坏。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const prof = path.join(os.homedir(), 'AppData', 'Roaming', 'dsh-desktop', 'harness', 'profiles', 'web')
const pluginDir = 'E:/.ai实验室/packages/dsh-primitive-pulse'
const name = 'dsh-primitive-pulse'

const patch = path.join(prof, 'cordis.patch.yml')
let s = fs.readFileSync(patch, 'utf8')
if (s.includes(name)) {
  console.log('patch: 已存在，跳过')
} else {
  s = s.replace(/\s*$/, '') + '\n\n# 语义脉冲：悬浮面板，实时看当前回答点亮了哪些语义基元（HowNet 义原）\n- insert:\n    - id: ' + name + '\n      name: ' + name + '\n'
  fs.writeFileSync(patch, s, 'utf8')
  console.log('patch: 已追加')
}

const pj = path.join(prof, 'package.json')
const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
j.dependencies = j.dependencies || {}
if (j.dependencies[name]) {
  console.log('package.json: 已存在，跳过')
} else {
  j.dependencies[name] = 'link:' + pluginDir
  fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log('package.json: 已追加 link 依赖')
}
console.log('done')
