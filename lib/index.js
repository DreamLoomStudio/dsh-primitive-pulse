/* 语义脉冲 · DSH 插件服务�? *
 * 做三件事�? *   �?把浏览器�?widget 注入�?Web 外壳里（桌面壳走 index-inject 行，浏览器壳�?tapIndex�? *   �?订阅 session/event，把每轮 assistant 的正文存成「最新一段文本�? *   �?提供三条静态资源路�?+ 一条状态轮询路�? *
 * 设计原则（抄 dsh-whale-widget 踩过的坑）：
 *   - 注入�?kind:'script'（永�?reject），不用 kind:'script-src'（加载失败会让整�?boot 挂掉，issue #154�? *   - 所有宿�?API 都包 try/catch，插件起不来也必须让宿主正常启动
 *   - 路由先过 connection.requestRejection 信任栅栏，能拿到�?fail-closed
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
  'data.js': 'sememe-data.js',
  'sememe-data.js': 'sememe-data.js',
  'board.html': 'board.html',
  'board-app.js': 'board-app.js',
  'board-samples.js': 'board-samples.js'
}

/* 最新一�?assistant 正文。插件只保存「最近一次」，不落盘、不留历史�?*/
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

/* 资产 URL 带上 mtime：改�?widget.js 之后普通刷新就能拿到新版，
 * 不用清缓存、也不用重启宿主�?*/
function assetUrl(name) {
  let v = 0
  try { v = Math.trunc(fs.statSync(path.join(ASSETS, ASSET_FILES[name])).mtimeMs) } catch {}
  return BASE + '/' + name + (v ? '?v=' + v : '')
}

/* 桌面壳：宿主启动时收集一次脚本行，之后没有刷新路径，所以只能推一行内联脚本，
 * 由它自己�?<script> 并吞�?onerror——路由不在时静默失败，绝不让宿主白屏�?*/
function inlineBootText() {
  const src = assetUrl('widget.js')
  return '(function(){try{var d=document.body||document.documentElement;if(!d)return;'
    + 'if(document.querySelector("script[data-dsh-pulse]"))return;'
    + 'var s=document.createElement("script");s.src="' + src + '";s.setAttribute("data-dsh-pulse","1");'
    + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()'
}

function bootScriptTag() {
  return '<script defer src="' + assetUrl('widget.js') + '" data-dsh-pulse="1"></script>'
}

export default {
  name: 'dsh-primitive-pulse',

  apply(root) {
    /* �?客户端注入：桌面�?*/
    try {
      root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          const src = BASE + '/widget.js'
          for (const row of table) {
            if (!row) continue
            // �??v= 的也算已注入，避免同一页推两次
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(src) >= 0) return
            if (row.kind === 'script-src' && typeof row.src === 'string' && row.src.indexOf(src) === 0) return
          }
          table.push({ kind: 'script', placement: 'body', text: inlineBootText() })
        } catch {}
      })
    } catch {}

    /* �?会话事件 �?最新一段正�?     * 直接�?root 上监听：session 服务发出�?session/event 会冒泡到祖先 context�?     * 不写 inject(['session']) 是因为那条依赖服务名可能不存在，缺了会静默不生效�?*/
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

    /* �?路由 */
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
          try { code = fence.requestRejection(req) } catch { return true } // 栅栏自身出错 �?fail-closed
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
        register(BASE + '/sememe-data.js', (req, res) => send(res, readAsset('sememe-data.js'), 'application/javascript; charset=utf-8'))
        /* ���壺������ĵ�ҳ��ʾ������������ϵġ����塹��ť�ڲ��� iframe ����� */
        register(BASE + '/board', (req, res) => send(res, readAsset('board.html'), 'text/html; charset=utf-8'))
        register(BASE + '/board.html', (req, res) => send(res, readAsset('board.html'), 'text/html; charset=utf-8'))
        register(BASE + '/board-app.js', (req, res) => send(res, readAsset('board-app.js'), 'application/javascript; charset=utf-8'))
        register(BASE + '/board-samples.js', (req, res) => send(res, readAsset('board-samples.js'), 'application/javascript; charset=utf-8'))
        /* 自检：浏览器里直接开 /dsh-pulse/ping 能看到这�?JSON，说明路由活着 */
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
          let wv = 0
          try { wv = Math.trunc(fs.statSync(path.join(ASSETS, 'widget.js')).mtimeMs) } catch {}
          const body = JSON.stringify({
            seq: state.seq,
            text: state.text,
            ts: state.ts,
            complete: state.complete,
            turn: state.turn,
            sessionId: state.sessionId,
            wv
          })
          send(res, body, 'application/json; charset=utf-8')
        })

        /* �?浏览器壳：直接改 index.html（桌面壳没有这一条，tapIndex 永不被调用） */
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
