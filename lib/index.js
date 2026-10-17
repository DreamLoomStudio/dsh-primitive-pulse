/* 语义脉冲 · DSH 插件服务端
 *
 * 做三件事：
 *   ① 把浏览器端 widget 注入到 Web 外壳里（桌面壳走 index-inject 行，浏览器壳走 tapIndex）
 *   ② 订阅 session/event，把每轮 assistant 的正文存成「最新一段文本」
 *   ③ 提供三条静态资源路由 + 一条状态轮询路由
 *
 * 设计原则（抄 dsh-whale-widget 踩过的坑）：
 *   - 注入用 kind:'script'（永不 reject），不用 kind:'script-src'（加载失败会让整个 boot 挂掉，issue #154）
 *   - 所有宿主 API 都包 try/catch，插件起不来也必须让宿主正常启动
 *   - 路由先过 connection.requestRejection 信任栅栏，能拿到就 fail-closed
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, '..', 'assets')
const BASE = '/dsh-pulse'

const ASSET_FILES = {
  'widget.js': 'widget.js',
  'core.js': 'core.js',
  'data.js': 'sememe-data.js'
}

/* 最新一段 assistant 正文。插件只保存「最近一次」，不落盘、不留历史。 */
const state = {
  seq: 0,
  text: '',
  ts: 0,
  sessionId: '',
  turn: null,
  complete: false
}

function extractText(data) {
  const out = []
  const push = (v) => { if (typeof v === 'string' && v.trim()) out.push(v) }

  if (!data || typeof data !== 'object') return ''

  push(data.text)
  push(data.content)
  push(data.delta)

  const msg = data.message
  if (typeof msg === 'string') push(msg)
  else if (msg && typeof msg === 'object') {
    push(msg.text)
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') push(part)
        else if (part && typeof part === 'object') {
          push(part.text)
          push(part.content)
        }
      }
    } else push(msg.content)
  }
  if (Array.isArray(data.parts)) {
    for (const part of data.parts) {
      if (typeof part === 'string') push(part)
      else if (part && typeof part === 'object') push(part.text)
    }
  }
  return out.join('\n').trim()
}

function readAsset(name) {
  try {
    return fs.readFileSync(path.join(ASSETS, ASSET_FILES[name]), 'utf8')
  } catch {
    return ''
  }
}

/* 桌面壳：宿主启动时收集一次脚本行，之后没有刷新路径，所以只能推一行内联脚本，
 * 由它自己建 <script> 并吞掉 onerror——路由不在时静默失败，绝不让宿主白屏。 */
function inlineBootText() {
  const src = BASE + '/widget.js'
  return '(function(){try{var d=document.body||document.documentElement;if(!d)return;'
    + 'if(document.querySelector("script[data-dsh-pulse]"))return;'
    + 'var s=document.createElement("script");s.src="' + src + '";s.setAttribute("data-dsh-pulse","1");'
    + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()'
}

function bootScriptTag() {
  return '<script defer src="' + BASE + '/widget.js" data-dsh-pulse="1"></script>'
}

export default {
  name: 'dsh-primitive-pulse',

  apply(root) {
    /* ① 客户端注入：桌面壳 */
    try {
      root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          const src = BASE + '/widget.js'
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(src) >= 0) return
            if (row.kind === 'script-src' && row.src === src) return
          }
          table.push({ kind: 'script', placement: 'body', text: inlineBootText() })
        } catch {}
      })
    } catch {}

    /* ② 会话事件 → 最新一段正文
     * 直接在 root 上监听：session 服务发出的 session/event 会冒泡到祖先 context。
     * 不写 inject(['session']) 是因为那条依赖服务名可能不存在，缺了会静默不生效。 */
    try {
      root.on('session/event', (session, event) => {
        try {
          if (!event || typeof event !== 'object') return
          const { type, data } = event
          if (type === 'assistant/message') {
            const text = extractText(data)
            if (!text) return
            state.seq += 1
            state.text = text
            state.ts = Date.now()
            state.complete = false
            state.turn = data && data.turn != null ? data.turn : null
            try { state.sessionId = (session && (session.id || session.sessionId)) || '' } catch {}
          } else if (type === 'turn/end') {
            state.complete = true
            state.ts = Date.now()
          }
        } catch {}
      })
    } catch {}

    /* ③ 路由 */
    try {
      root.inject(['webServer'], (ctx) => {
        let fence = null
        try {
          const conn = (typeof ctx.get === 'function' && ctx.get('connection')) || ctx.connection
          if (conn && typeof conn.requestRejection === 'function') fence = conn
        } catch {}

        const rejected = (req, res) => {
          if (!fence) return false
          let code = null
          try { code = fence.requestRejection(req) } catch { return true } // 栅栏自身出错 → fail-closed
          if (code == null || code === false) return false
          try { res.statusCode = typeof code === 'number' ? code : 403; res.end() } catch {}
          return true
        }

        const send = (res, body, type) => {
          try {
            res.statusCode = 200
            res.setHeader('Content-Type', type)
            res.setHeader('Cache-Control', 'no-store')
            res.end(body)
          } catch {}
        }

        const register = (pathname, handler) => {
          try {
            ctx.webServer.register({
              kind: 'exact',
              path: pathname,
              handler: (req, res) => {
                if (rejected(req, res)) return
                try { handler(req, res) } catch {
                  try { res.statusCode = 500; res.end('error') } catch {}
                }
              }
            })
            return true
          } catch { return false }
        }

        register(BASE + '/widget.js', (req, res) => send(res, readAsset('widget.js'), 'application/javascript; charset=utf-8'))
        register(BASE + '/core.js', (req, res) => send(res, readAsset('core.js'), 'application/javascript; charset=utf-8'))
        register(BASE + '/data.js', (req, res) => send(res, readAsset('data.js'), 'application/javascript; charset=utf-8'))
        /* 自检：浏览器里直接开 /dsh-pulse/ping 能看到这行 JSON，说明路由活着 */
        register(BASE + '/ping', (req, res) => {
          send(res, JSON.stringify({
            ok: true,
            plugin: 'dsh-primitive-pulse',
            assets: {
              widget: readAsset('widget.js').length,
              core: readAsset('core.js').length,
              data: readAsset('data.js').length
            },
            seq: state.seq,
            hasText: !!state.text
          }), 'application/json; charset=utf-8')
        })
        register(BASE + '/state', (req, res) => {
          const body = JSON.stringify({
            seq: state.seq,
            text: state.text,
            ts: state.ts,
            complete: state.complete,
            turn: state.turn,
            sessionId: state.sessionId
          })
          send(res, body, 'application/json; charset=utf-8')
        })

        /* ② 浏览器壳：直接改 index.html（桌面壳没有这一条，tapIndex 永不被调用） */
        try {
          ctx.webServer.tapIndex((html) => {
            try {
              if (typeof html !== 'string' || html.indexOf(BASE + '/widget.js') >= 0) return html
              return html.indexOf('</body>') >= 0
                ? html.replace('</body>', bootScriptTag() + '</body>')
                : html + bootScriptTag()
            } catch { return html }
          })
        } catch {}
      })
    } catch {}
  }
}
