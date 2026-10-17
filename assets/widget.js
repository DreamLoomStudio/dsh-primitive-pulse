/* 语义脉冲 · 浏览器端挂件
 *
 * 零依赖 IIFE：自己建 DOM，不碰宿主的 React 树。
 * 数据链路：/dsh-pulse/state（轮询）→ core.js 分词 + 义原流 → 三个面板
 * 两种形态：右下角圆钮展开的悬浮面板；背景模式（星图铺满页面、慢速自旋）
 */
(function () {
  'use strict'
  if (window.__dshPulseLoaded) return
  window.__dshPulseLoaded = true
  /* 代际令牌：面板上的 ↻ 重载时，旧实例的 rAF / 轮询要能自杀，
     否则重载几次会有好几条循环在画已经摘掉的 canvas。 */
  var GEN = window.__dshPulseGen = (window.__dshPulseGen || 0) + 1
  function dead() { return window.__dshPulseDead === GEN }
  window.__dshPulseStop = function () { window.__dshPulseDead = GEN }
  /* 记录自己是哪个版本的脚本（服务端注入时会带 ?v=<mtime>），轮询时跟磁盘上的 mtime 对账 */
  var SELF_V = (function () {
    try {
      var src = (document.currentScript && document.currentScript.src) || ''
      var m = /[?&]v=(-?\d+)/.exec(src)
      return m ? m[1] : ''
    } catch (e) { return '' }
  })()

  var BASE = '/dsh-pulse'
  var Z = 2147483000
  var ZB = 2147482999
  var state = { seq: -1, text: '', ts: 0, complete: false }
  var engine = null
  var loading = false
  var replay = null
  var opened = lsGet('dshPulseOpened', '0') === '1'
  var bgOn = false
  var theme = lsGet('dshPulseTheme', 'neon')   // neon=深底冷光脉冲 / liquid=浅底黑墨涌动
  var lastTick = 0

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v } catch (e) { return d } }
  function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) {} }

  /* ---------- 样式 ---------- */
  function css() {
    var s = document.createElement('style')
    s.setAttribute('data-dsh-pulse', '1')
    s.textContent = [
      '#dsh-pulse-btn{position:fixed;right:18px;bottom:104px;width:44px;height:44px;border-radius:50%;',
      'background:radial-gradient(circle at 35% 30%,#2b4a72,#101a28 70%);border:1px solid rgba(120,180,255,.42);',
      'box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 0 1px rgba(120,180,255,.12) inset;cursor:grab;z-index:' + Z + ';',
      'display:flex;align-items:center;justify-content:center;transition:border-color .16s ease,box-shadow .16s ease;touch-action:none}',
      '#dsh-pulse-btn:hover{border-color:rgba(150,205,255,.75)}',
      '#dsh-pulse-btn.dragging{cursor:grabbing;transform:scale(1.04)}',
      '#dsh-pulse-btn svg{width:22px;height:22px;display:block;pointer-events:none}',
      '#dsh-pulse-bg{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;',
      'opacity:0;transition:opacity .45s ease;',
      '-webkit-mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,#000 56%,transparent 100%);',
      'mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,#000 56%,transparent 100%)}',
      '#dsh-pulse-bg.on{opacity:.62}',
      '#dsh-pulse-bg.light.on{opacity:.50}',
      /* 面板只有一个主题：暗底 + 霓虹蓝白。变量留着是为了以后改色方便 */
      '#dsh-pulse-panel{--p-bg:rgba(9,14,22,.97);--p-fg:#cfe0f2;--p-dim:#7f97b4;--p-head:#8fb3d6;--p-sub:#5d7590;',
      '--p-line:rgba(96,150,220,.16);--p-accent:#5aa4ff;--p-card:#0b1420;--p-headd:linear-gradient(180deg,rgba(30,52,80,.55),rgba(12,18,28,.2));--p-bar1:#2f6fb5;--p-bar2:#5aa4ff;',
      'position:fixed;right:18px;bottom:160px;width:404px;max-height:calc(100vh - 220px);',
      'background:var(--p-bg);border:1px solid var(--p-line);border-radius:14px;',
      'box-shadow:0 18px 60px rgba(0,0,0,.62);z-index:' + Z + ';display:none;flex-direction:column;',
      'font:12px/1.5 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;color:var(--p-fg);overflow:hidden}',
      '#dsh-pulse-panel.on{display:flex}',
      '.dsp-head{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid rgba(96,150,220,.16);',
      'cursor:move;user-select:none;background:var(--p-headd)}',
  '/* —— 跟随主题：只换外框、标题、指纹卡、底栏；两块发光画布（星图 / 基元流）钉死暗底 —— */ html.dsp-light #dsh-pulse-panel{--p-bg:rgba(255,255,255,.97);--p-fg:#1b2634;--p-dim:#5d6b7c;--p-sub:#33414f;--p-head:rgba(238,243,250,.96);--p-line:rgba(40,70,110,.14);--p-accent:#2b6fd0;--p-card:#eef3fa;--p-headd:linear-gradient(180deg,rgba(226,233,244,.75),rgba(246,249,253,.35));--p-bar1:#7fa8dd;--p-bar2:#2b6fd0;box-shadow:0 18px 50px rgba(30,50,80,.18)} html.dsp-light #dsh-pulse-panel #dsp-brain,html.dsp-light #dsh-pulse-panel #dsp-eeg{background:#0b1420;border-color:rgba(96,150,220,.18)} html.dsp-light #dsh-pulse-panel #dsp-eeg{background:#0d1726}',
      '.dsp-dot{width:7px;height:7px;border-radius:50%;background:#4ea1ff;box-shadow:0 0 8px #4ea1ff}',
      '.dsp-title{font-weight:600;letter-spacing:.04em;color:var(--p-fg)}',
      '.dsp-sub{color:var(--p-dim);font-size:11px;margin-left:auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsp-x{cursor:pointer;color:var(--p-dim);font-size:15px;line-height:1;padding:0 2px}',
    '.dsp-rl{cursor:pointer;color:var(--p-dim);font-size:14px;line-height:1;padding:0 4px;margin-left:2px}',
    '.dsp-rl:hover{color:#8fc4ff;transform:rotate(180deg);transition:transform .3s}',
      '.dsp-x:hover{color:var(--p-fg)}',
      '.dsp-body{padding:8px 11px 11px;overflow:auto}',
      '.dsp-sec{margin-top:9px}',
      '.dsp-sec h4{margin:0 0 5px;font-size:11px;font-weight:600;color:var(--p-head);letter-spacing:.05em;display:flex;align-items:center;gap:6px}',
      '.dsp-sec h4 span{color:var(--p-sub);font-weight:400;letter-spacing:0}',
      '.dsp-sec h4 em{margin-left:auto;font-style:normal;font-size:10.5px;color:var(--p-accent);cursor:pointer;border:1px solid var(--p-accent);font-weight:600;',
      'border-radius:5px;padding:1px 6px}',
      '.dsp-sec h4 em.on{background:var(--p-accent);color:#fff}',
    /* 液态主题：面板里的星图改成浅纸底 */
    
      'canvas.dsp-cv{width:100%;display:block;border-radius:8px;background:radial-gradient(circle at 50% 45%,rgba(22,38,58,.55),rgba(7,11,18,.9))}',
      '.dsp-fp{display:flex;align-items:center;gap:6px;margin:3px 0}',
      '.dsp-fp i{font-style:normal;width:74px;color:var(--p-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}',
      '.dsp-fp b{font-weight:400;height:7px;border-radius:3px;background:linear-gradient(90deg,var(--p-bar1),var(--p-bar2));min-width:2px}',
      '.dsp-fp u{text-decoration:none;color:var(--p-sub);font-size:10px;width:30px;text-align:right}',
      '.dsp-cap{color:var(--p-dim);font-size:11px;margin-top:8px;line-height:1.6;border-left:2px solid var(--p-accent);padding-left:7px}',
      '.dsp-foot{display:flex;align-items:center;gap:8px;padding:7px 11px;border-top:1px solid var(--p-line);color:var(--p-sub);font-size:10.5px}',
      '.dsp-link{cursor:pointer;color:var(--p-accent);text-decoration:none}',
      '.dsp-link:hover{text-decoration:underline}',
      '.dsp-input{display:none;padding:0 11px 10px}',
      '.dsp-input.on{display:block}',
      '.dsp-input textarea{width:100%;height:64px;background:var(--p-card);color:var(--p-fg);border:1px solid var(--p-line);',
      'border-radius:7px;padding:6px 7px;font:11.5px/1.5 inherit;resize:vertical;box-sizing:border-box}',
      '.dsp-input button{margin-top:5px;background:var(--p-card);padding:4px 10px;border-radius:6px;',
      'border:1px solid var(--p-line);color:var(--p-fg);cursor:pointer;font-size:11px}'
    ].join('')
    document.head.appendChild(s)
  }

  /* ---------- DOM ---------- */
  var btn, panel, subEl, footEl, capEl, bgCanvas

  /* 找一个「铺满视口且有实心底色」的容器当背景宿主。
     直接挂在 body 上会被应用自己画的不透明底色盖住 —— 因为负 z-index 的
     画布只在最近的层叠上下文里生效，应用那层底色在它之上。
     解法：把画布插进那个容器内部当第一个子节点，并给它 isolation:isolate
     造出独立的层叠上下文，负 z-index 就能落在这层底色之上、内容之下。 */
  function opaque(c) {
    return !!c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)'
  }

  /* 用命中测试找「真正挡住画面的那一层」：
     elementsFromPoint 给的是从最上到最下的完整层栈，从上往下扫，
     第一个有实心底色的元素 = 那一处最深的不透明底。
     把画布插成它的第一个子节点 + isolation:isolate，画布就落在
     它的底色之上、它所有内容之下 —— 这正是背景该待的位置。 */
  function findBgHost() {
    var vw = window.innerWidth || 1200, vh = window.innerHeight || 800
    var els = null
    try { els = document.elementsFromPoint(vw / 2, vh / 2) } catch (x) {}
    if (els && els.length) {
      for (var i = 0; i < els.length; i++) {
        var e = els[i]
        if (e === bgCanvas || (bgCanvas && bgCanvas.contains(e))) continue
        var cs = null
        try { cs = window.getComputedStyle(e) } catch (x2) { continue }
        if (e.tagName === 'HTML') break
        if (!opaque(cs.backgroundColor)) continue
        return e
      }
    }
    // 兜底：老办法（扫 DOM，取最深的、盖住屏幕中心的不透明面板）
    var root = document.getElementById('root') || document.body
    var list = root.querySelectorAll('*')
    var limit = Math.min(list.length, 8000)
    var cx = vw / 2, cy = vh / 2, vArea = vw * vh
    var best = null, bestArea = Infinity
    for (var j = 0; j < limit; j++) {
      var el = list[j]
      if (el === bgCanvas) continue
      var r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue
      var bgc2 = '', cs2 = null
      try { cs2 = window.getComputedStyle(el); bgc2 = cs2.backgroundColor } catch (x3) {}
      if (!opaque(bgc2)) continue
      if (cs2 && (cs2.transform !== 'none' || cs2.filter !== 'none' || cs2.perspective !== 'none')) continue
      var area = r.width * r.height
      if (area < vArea * 0.30) continue
      if (area < bestArea) { bestArea = area; best = el }
    }
    return best
  }

  var bgDiag = ''
  function descOf(el) {
    if (!el) return 'null'
    var s = (el.tagName || '?').toLowerCase()
    if (el.id) s += '#' + el.id
    var cls = (el.className && String(el.className).trim()) ? String(el.className).trim().split(/\s+/)[0] : ''
    if (cls) s += '.' + cls
    return s
  }

  /* 底色亮不亮：决定星图用「照亮墨底」还是「墨照白底」 */
  function lumOf(color) {
    var m = /rgba?\(([^)]+)\)/.exec(color || '')
    if (!m) return 0
    var p = m[1].split(',')
    var a = p.length > 3 ? parseFloat(p[3]) : 1
    if (!(a >= 0.5)) return 0            // 半透明就当深底处理
    return (0.299 * parseFloat(p[0]) + 0.587 * parseFloat(p[1]) + 0.114 * parseFloat(p[2])) / 255
  }

  /* 背景墨色固定用 paper（浅蓝白），不再跟随宿主明暗 —— 只保留一个主题 */
  function syncHostTheme() {
    var light = false
    try {
      var root = document.getElementById('root') || document.body
      var c1 = window.getComputedStyle(root).backgroundColor
      light = lumOf(c1) > 0.55
      if (!light) {
        var c2 = window.getComputedStyle(document.body).backgroundColor
        if (opaque(c2)) light = lumOf(c2) > 0.55
      }
    } catch (e) {}
    bgPal = 'paper'
    try { document.documentElement.classList.toggle('dsp-light', light) } catch (x9) {}
    return light
  }
  /* ===== 背景层：独立 stage + 让页面底色让位 =====
     之前把画布塞进「命中的那一层」里，只要它的某个祖先有 transform /
     形成层叠上下文，position:fixed 就被那句话的盒子夹住，人根本看不到。
     改成：body 下第一个子节点放一个覆盖全屏的 stage（fixed，z-index 0），
     然后把「盖住整个视口的大块不透明底色」临时调成透明，
     画布就落在页面底色之上、所有内容之下。关掉时原样还回去。 */
  var stageEl = null
  var clearedBg = []

  function ensureStage() {
    if (stageEl && stageEl.parentNode) return stageEl
    stageEl = document.createElement('div')
    stageEl.id = 'dsh-pulse-stage'
    stageEl.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;'
    bgCanvas.style.position = 'absolute'
    bgCanvas.style.left = '0'
    bgCanvas.style.top = '0'
    bgCanvas.style.width = '100%'
    bgCanvas.style.height = '100%'
    stageEl.appendChild(bgCanvas)
    if (document.body.firstChild) document.body.insertBefore(stageEl, document.body.firstChild)
    else document.body.appendChild(stageEl)
    return stageEl
  }

  /* 只挖「整屏级别」的底色（页面底、主容器底），不动消息气泡、卡片这类小面积底色 */
  function clearPagePaint() {
    var vw = window.innerWidth || 1200, vh = window.innerHeight || 800
    var vArea = vw * vh
    var list = []
    try { list = document.elementsFromPoint(vw / 2, vh * 0.35) || [] } catch (x) {}
    var picked = []
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (!el || el.tagName === 'HTML' || el === stageEl) continue
      var cs = null
      try { cs = window.getComputedStyle(el) } catch (x2) { continue }
      if (!opaque(cs.backgroundColor)) continue
      var r = el.getBoundingClientRect()
      if (r.width * r.height < vArea * 0.55) continue      // 小面积的别动
      picked.push(el)
    }
    for (var k = 0; k < picked.length; k++) {
      var e = picked[k]
      if (e.getAttribute('data-dsp-bgcleared') === '1') continue
      e.setAttribute('data-dsp-bgcleared', '1')
      e.setAttribute('data-dsp-bgold', e.style.backgroundColor || '')
      e.style.backgroundColor = 'transparent'
      clearedBg.push(e)
    }
    return picked.length
  }

  function restorePagePaint() {
    for (var i = 0; i < clearedBg.length; i++) {
      var e = clearedBg[i]
      e.style.backgroundColor = e.getAttribute('data-dsp-bgold') || ''
      e.removeAttribute('data-dsp-bgcleared')
      e.removeAttribute('data-dsp-bgold')
    }
    clearedBg = []
  }

  function mountBg() {
    ensureStage()
    var n = clearPagePaint()
    var light = syncHostTheme()
    bgPal = 'paper'
    bgCanvas.classList[light ? 'add' : 'remove']('light')
    bgDiag = '背景层 stage · 让位 ' + n + ' 层' + (light ? ' 明底·浅蓝白' : ' 暗底')
    return light
  }

  function unmountBg() {
    restorePagePaint()
  }

  function build() {
    css()

    bgCanvas = document.createElement('canvas')
    bgCanvas.id = 'dsh-pulse-bg'
    mountBg()

    btn = document.createElement('div')
    btn.id = 'dsh-pulse-btn'
    btn.title = '语义脉冲（Ctrl+Shift+P）· 可拖动'
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#8fc4ff" stroke-width="1.5">'
      + '<path d="M3 13h3l2-5 3 10 2.5-7 2 4H21" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    document.body.appendChild(btn)
    restoreBtnPos()

    panel = document.createElement('div')
    panel.id = 'dsh-pulse-panel'
    panel.innerHTML = [
      '<div class="dsp-head"><span class="dsp-dot"></span><span class="dsp-title">语义脉冲</span>',
      '<span class="dsp-sub">等待回答…</span><span class="dsp-rl" title="重载挂件（改完代码不用重启）">↻</span>',
      '<span class="dsp-x" title="收起">✕</span></div>',
      '<div class="dsp-body">',
      '  <div class="dsp-sec"><h4>基元星图 <span>每个点 = 一簇义原</span><em id="dsp-bgtoggle">背景模式</em></h4>',
      '    <canvas class="dsp-cv" id="dsp-brain" height="220"></canvas></div>',
      '  <div class="dsp-sec"><h4>基元流 <span>义原激活曲线</span></h4>',
      '    <canvas class="dsp-cv" id="dsp-eeg" height="150"></canvas></div>',
      '  <div class="dsp-sec"><h4>指纹卡 <span>按占比降序</span></h4><div id="dsp-fp"></div></div>',
      '  <div class="dsp-cap" id="dsp-cap">打开后会自动读取本会话里最新的一段回答。</div>',
      '</div>',
      '<div class="dsp-input" id="dsp-input"><textarea placeholder="也可以粘一段文字进来分析…"></textarea>',
      '<button type="button" id="dsp-run">分析这段</button></div>',
      '<div class="dsp-foot"><span id="dsp-foot">未载入</span>',
      '<a class="dsp-link" id="dsp-paste" style="margin-left:auto">手动粘贴</a></div>'
    ].join('')
    document.body.appendChild(panel)

    subEl = panel.querySelector('.dsp-sub')
    footEl = panel.querySelector('#dsp-foot')
    capEl = panel.querySelector('#dsp-cap')

    panel.querySelector('.dsp-x').addEventListener('click', toggle)
    panel.querySelector('.dsp-rl').addEventListener('click', reloadWidget)
    panel.querySelector('#dsp-paste').addEventListener('click', function () {
      panel.querySelector('#dsp-input').classList.toggle('on')
    })
    panel.querySelector('#dsp-run').addEventListener('click', function () {
      var ta = panel.querySelector('#dsp-input textarea')
      var v = (ta.value || '').trim()
      if (!v) return
      ensureEngine(function () { analyze(v, '粘贴') })
    })
    var bgT = panel.querySelector('#dsp-bgtoggle')
    bgT.addEventListener('click', function (e) {
      e.stopPropagation()
      setBackground(!bgOn)
    })

    var thT = panel.querySelector('#dsp-theme')
    if (thT) {
      thT.textContent = theme === 'liquid' ? '液态' : '脉冲'
      thT.title = '切换星图风格：脉冲（深底冷光）/ 液态（浅底黑墨涌动）'
      thT.addEventListener('click', function (e) {
        e.stopPropagation()
        theme = theme === 'liquid' ? 'neon' : 'liquid'
        lsSet('dshPulseTheme', theme)
        thT.textContent = theme === 'liquid' ? '液态' : '脉冲'
        applyTheme()
      })
    }

    // 圆钮：拖动 + 点击
    var drag = null
    btn.addEventListener('mousedown', function (e) {
      drag = { x: e.clientX, y: e.clientY, moved: false, r: btn.getBoundingClientRect() }
      e.preventDefault()
    })
    window.addEventListener('mousemove', function (e) {
      if (!drag) return
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      drag.moved = true
      btn.classList.add('dragging')
      var left = Math.min(window.innerWidth - 52, Math.max(6, drag.r.left + dx))
      var top = Math.min(window.innerHeight - 52, Math.max(6, drag.r.top + dy))
      btn.style.left = left + 'px'
      btn.style.top = top + 'px'
      btn.style.right = 'auto'
      btn.style.bottom = 'auto'
    })
    window.addEventListener('mouseup', function () {
      if (!drag) return
      var wasDrag = drag.moved
      drag = null
      btn.classList.remove('dragging')
      if (wasDrag) {
        var r = btn.getBoundingClientRect()
        lsSet('dshPulseBtn', JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top) }))
      } else {
        toggle()
      }
    })

    // 面板拖动
    var pdrag = null
    var head = panel.querySelector('.dsp-head')
    head.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('dsp-x') || e.target.id === 'dsp-bgtoggle') return
      pdrag = { x: e.clientX, y: e.clientY, r: panel.getBoundingClientRect() }
      e.preventDefault()
    })
    window.addEventListener('mousemove', function (e) {
      if (!pdrag) return
      panel.style.right = 'auto'; panel.style.bottom = 'auto'
      panel.style.left = Math.max(6, Math.min(window.innerWidth - 200, pdrag.r.left + e.clientX - pdrag.x)) + 'px'
      panel.style.top = Math.max(6, Math.min(window.innerHeight - 100, pdrag.r.top + e.clientY - pdrag.y)) + 'px'
    })
    window.addEventListener('mouseup', function () {
      if (!pdrag) return
      pdrag = null
      var r = panel.getBoundingClientRect()
      lsSet('dshPulsePanel', JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top) }))
    })

    window.addEventListener('resize', function () {
      fit(bgCanvas, window.innerHeight)
      var b = document.getElementById('dsp-brain'), g = document.getElementById('dsp-eeg')
      if (b) fit(b, 220)
      if (g) fit(g, 150)
    })

    fit(panel.querySelector('#dsp-brain'), 220)
    fit(panel.querySelector('#dsp-eeg'), 150)
    fit(bgCanvas, window.innerHeight)

    // 面板位置也记住：热更/重启后不再甩回右边
    var savedPos = ''
    try { savedPos = lsGet('dshPulsePanel', '') } catch (e0) { savedPos = '' }
    if (savedPos) {
      try {
        var sp = JSON.parse(savedPos)
        if (sp && isFinite(sp.l) && isFinite(sp.t)) {
          panel.style.right = 'auto'
          panel.style.bottom = 'auto'
          panel.style.left = Math.max(6, Math.min(window.innerWidth - 220, sp.l)) + 'px'
          panel.style.top = Math.max(6, Math.min(window.innerHeight - 120, sp.t)) + 'px'
        }
      } catch (e1) {}
    }

    // 热更会重建 DOM：面板开合状态从 localStorage 恢复，别每次跳回小球
    // （必须放在 panel 建完之后，否则一次 ReferenceError 就能把整个 build 打死 —— 球会变成死的）
    if (opened) {
      panel.classList.add('on')
      fit(panel.querySelector('#dsp-brain'), 220)
      fit(panel.querySelector('#dsp-eeg'), 150)
    }
    try { applyTheme() } catch (e) {}

    if (lsGet('dshPulseBg', '0') === '1') setBackground(true)
  }

  function restoreBtnPos() {
    var raw = lsGet('dshPulseBtn', '')
    if (!raw) return
    try {
      var p = JSON.parse(raw)
      if (typeof p.l === 'number' && typeof p.t === 'number') {
        btn.style.left = Math.min(window.innerWidth - 52, Math.max(6, p.l)) + 'px'
        btn.style.top = Math.min(window.innerHeight - 52, Math.max(6, p.t)) + 'px'
        btn.style.right = 'auto'
        btn.style.bottom = 'auto'
      }
    } catch (e) {}
  }

  /* 画布尺寸：CSS 高度必须显式给，否则 canvas 的 height 属性会被当成 CSS 像素，图被拉长 */
  function fit(cv, cssH) {
    if (!cv) return
    var w = cv.clientWidth || 380
    var dpr = Math.min(2, window.devicePixelRatio || 1)
    cv._w = w
    cv._h = cssH
    cv.style.height = cssH + 'px'
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(cssH * dpr)
  }

  /* 跟随宿主明暗：只影响面板外框配色，两块发光画布固定暗底 */
  function applyTheme() {
    try { syncHostTheme() } catch (e) {}
  }

  function setBackground(on) {
    bgOn = !!on
    lsSet('dshPulseBg', bgOn ? '1' : '0')
    bgCanvas.classList.toggle('on', bgOn)
    // 不依赖 CSS 类：直接写行内样式，避免被宿主的样式覆盖或类名没生效
    var isLight = false
    isLight = (bgPal === 'paper')
    bgCanvas.style.opacity = bgOn ? (isLight ? '0.92' : '0.72') : '0'
    bgCanvas.style.display = bgOn ? 'block' : 'none'
    bgCanvas.setAttribute('data-bg', bgOn ? '1' : '0')
    var t = panel.querySelector('#dsp-bgtoggle')
    if (t) t.classList.toggle('on', bgOn)
    if (!bgOn) { unmountBg() }
    if (bgOn) {
      mountBg()   // 应用可能重渲染过，宿主换了就重新贴一次
      fit(bgCanvas, window.innerHeight)
      ensureEngine(function () {})
      if (footEl) footEl.textContent = bgDiag   // 诊断：开着背景时底栏告诉你它贴到哪了
    }
  }

  /* ---------- 开关 ---------- */
  function toggle() {
    opened = !opened
    lsSet('dshPulseOpened', opened ? '1' : '0')
    panel.classList.toggle('on', opened)
    if (opened) {
      fit(panel.querySelector('#dsp-brain'), 220)
      fit(panel.querySelector('#dsp-eeg'), 150)
      ensureEngine(function () { poll(true) })
    }
  }

  /* ---------- 引擎 ---------- */
  function loadScript(src, done) {
    var s = document.createElement('script')
    s.src = src
    s.onload = function () { done(null) }
    s.onerror = function () { done(new Error('load ' + src)) }
    document.head.appendChild(s)
  }

  function ensureEngine(done) {
    if (engine) return done && done()
    if (window.PrimitiveCore && window.SEMEME_CORE) {
      try {
        engine = { idx: window.PrimitiveCore.buildIndex(window.SEMEME_CORE) }
        footEl.textContent = '就绪 · 义原 ' + window.SEMEME_CORE.s.length
        return done && done()
      } catch (e) {
        footEl.textContent = '初始化失败：' + (e && e.message)
        return
      }
    }
    if (loading) return
    loading = true
    footEl.textContent = '载入义原词典…'
    loadScript(BASE + '/core.js', function (err) {
      if (err || !window.PrimitiveCore) { footEl.textContent = '核心脚本载入失败'; loading = false; return }
      loadScript(BASE + '/data.js', function (err2) {
        if (err2 || !window.SEMEME_CORE) { footEl.textContent = '词典载入失败'; loading = false; return }
        var t0 = performance.now()
        try {
          engine = { idx: window.PrimitiveCore.buildIndex(window.SEMEME_CORE) }
          footEl.textContent = '就绪 · 义原 ' + window.SEMEME_CORE.s.length + ' / '
            + Math.round(performance.now() - t0) + 'ms'
          loading = false
          done && done()
        } catch (e) {
          footEl.textContent = '初始化失败：' + (e && e.message)
          loading = false
        }
      })
    })
  }

  /* ---------- 数据 ---------- */
  /* 防热更狂飙：15 秒内最多自动重载 3 次，超了就停手（否则改错代码会把面板锁在重启循环里） */
  function canAutoReload() {
    try {
      var r = JSON.parse(sessionStorage.getItem('dshPulseReloads') || '{"t":0,"n":0}')
      if (Date.now() - r.t > 15000) r = { t: Date.now(), n: 0 }
      r.n++
      sessionStorage.setItem('dshPulseReloads', JSON.stringify(r))
      return r.n <= 3
    } catch (e) { return true }
  }

  function poll(force) {
    if (!opened && !bgOn) return
    fetch(BASE + '/state', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json() })
      .then(function (s) {
        // 自动热更默认关掉：改代码时它会每轮重建面板（画面闪烁 + 把拖好的位置弹回右边）。
        // 只用右上角 ↻ 手动换版本；确实要自动，把 dshPulseAutoReload 设成 '1'。
        if (s && s.wv && String(s.wv) !== String(SELF_V) && lsGet('dshPulseAutoReload', '0') === '1') {
          if (canAutoReload()) { reloadWidget(s.wv); return }
        }
        try { syncHostTheme() } catch (e2) {}
        var changed = s && s.seq !== state.seq && s.text
        state = s || state
        if (subEl) {
          subEl.textContent = s && s.text
            ? (s.complete ? '已生成 · ' + fmtTime(s.ts) : '生成中 · ' + fmtTime(s.ts))
            : '等待回答…'
        }
        if (changed || force) analyze(state.text, '会话')
      })
      .catch(function () {})
  }

  function fmtTime(ts) {
    if (!ts) return ''
    var d = new Date(ts)
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
  }

  /* ---------- 分析 ---------- */
  function analyze(text, source) {
    if (!engine || !text) return
    var C = window.PrimitiveCore
    var res, fp, tokens
    try {
      tokens = C.segment(text, engine.idx)
      res = C.stream(tokens, engine.idx, { topK: 8 })
      fp = C.fingerprint(res, engine.idx)
    } catch (e) {
      footEl.textContent = '分析失败：' + (e && e.message)
      return
    }

    var core = window.SEMEME_CORE
    var cl = core.cl || []
    var nCl = (core.cc ? core.cc.length / 3 : 0) | 0
    var frames = []
    var step = Math.max(1, Math.floor(res.series.length / 220))
    for (var f = 0; f < res.series.length; f += step) {
      var fr = new Float32Array(nCl)
      var row = res.series[f]
      for (var i = 0; i < cl.length; i++) {
        var v = row[i]
        if (v > 0) fr[cl[i]] += v
      }
      var mx = 0
      for (var k = 0; k < nCl; k++) if (fr[k] > mx) mx = fr[k]
      if (mx > 0) for (var k2 = 0; k2 < nCl; k2++) fr[k2] /= mx
      frames.push(fr)
    }

    var chans = []
    for (var ci = 0; ci < res.top.length; ci++) {
      var sid = res.top[ci]
      var arr = new Float32Array(res.series.length)
      for (var f2 = 0; f2 < res.series.length; f2++) arr[f2] = res.series[f2][sid] / (res.maxV || 1)
      chans.push(arr)
    }

    // 整段回答的累计峰值：回放结束后靠它做「呼吸闪烁」，空闲时也有东西看
    var acc = new Float32Array(nCl)
    for (var fa = 0; fa < frames.length; fa++) {
      var rowf = frames[fa]
      for (var ia = 0; ia < nCl; ia++) if (rowf[ia] > acc[ia]) acc[ia] = rowf[ia]
    }

    replay = {
      frames: frames, step: step, tops: res.top, map: res.sememes, i: 0,
      held: new Float32Array(nCl), fp: fp, tokens: tokens, source: source,
      chans: chans, n: res.series.length, maxV: res.maxV || 1, acc: acc
    }

    capEl.textContent = '语义重心：' + (fp.regions.slice(0, 3).map(function (x) { return x.name }).join(' / '))
      + '（最高一区占 ' + Math.round((fp.regions[0] ? fp.regions[0].share : 0) * 100) + '%）。'
    renderFingerprint(fp)

    footEl.textContent = source + ' · ' + tokens.length + ' token · 未登录义原 '
      + Math.round((fp.stats ? fp.stats.oovRate : 0) * 100) + '%'
  }

  /* ---------- 主循环 ---------- */
  var idleHeld = null, idleBase = null
  function heldVec() {
    if (replay) return replay.held
    var n = (window.SEMEME_CORE && window.SEMEME_CORE.cc ? window.SEMEME_CORE.cc.length / 3 : 0) | 0
    n = Math.max(0, n)
    if (!idleHeld || idleHeld.length !== n) {
      idleHeld = new Float32Array(n)
      idleBase = new Float32Array(n)
      // 静息基线：每个节点给一点基础激活，让网格连线在没输出时也看得见
      for (var i = 0; i < n; i++) {
        idleBase[i] = 0.30 + 0.22 * (0.5 + 0.5 * Math.sin(i * 2.399))
        idleHeld[i] = idleBase[i]
      }
    }
    return idleHeld
  }

  function tick(t) {
    if (dead()) return
    requestAnimationFrame(tick)
    if (t - lastTick < 33) return
    lastTick = t

    if (replay) {
      var fr = replay.frames[replay.i]
      if (fr) {
        // 快攻慢放：激活立刻到位（不做渐入），之后缓慢衰减
        for (var i = 0; i < fr.length; i++) {
          var h = replay.held[i] * 0.86
          replay.held[i] = fr[i] > h ? fr[i] : h
        }
        replay.i++
      } else if (replay.acc) {
        // 流水放完：把整段回答点亮过的节点做成呼吸闪烁（相位错开，像余辉在游）
        var acc = replay.acc
        for (var k = 0; k < acc.length; k++) {
          if (acc[k] < 0.02) { replay.held[k] *= 0.96; continue }
          var ph = (k * 2.399) % 6.2832
          var beat = 0.44 + 0.56 * (0.5 + 0.5 * Math.sin(t * 0.0017 + ph))
          replay.held[k] = acc[k] * beat
        }
      }
    } else if (idleBase) {
      // 还没有任何回答时也让它活着：整片网格一起缓慢呼吸
      var gb = 0.70 + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.0009))
      for (var ib = 0; ib < idleBase.length; ib++) {
        idleHeld[ib] = idleBase[ib] * (gb * (0.82 + 0.18 * Math.sin(t * 0.0013 + ib * 0.37)))
      }
    }

    var held = heldVec()
    if (!held.length) {
      if (bgOn) bgHint(t)      // 词典还没载完：背景至少要有反馈
      return
    }

    if (opened) {
      var b = document.getElementById('dsp-brain')
      if (b) drawScene(b, held, t, -1.25 + Math.sin(t * 0.00012) * 0.22, 1, { bg: false })
      var g = document.getElementById('dsp-eeg')
      if (g && replay) drawEeg(g, replay, t)
    }
    if (bgOn) {
      drawScene(bgCanvas, held, t, t * 0.00007 - 1.15, 1.0, { bg: true })
      if (!engine) bgHint(t)
    }
  }

  /* 背景模式的数据还没就绪时，至少让人看见这块画布在工作 */
  function bgHint(t) {
    var cv = bgCanvas
    if (!cv || !cv._w) return
    var ctx = cv.getContext('2d')
    var W = cv.width, H = cv.height, dpr = W / cv._w
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    var pulse = 0.45 + 0.35 * Math.sin(t * 0.002)
    ctx.fillStyle = 'rgba(120,180,255,' + pulse.toFixed(2) + ')'
    ctx.font = (14 * dpr) + 'px -apple-system,"Segoe UI",system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('语义脉冲 · 背景模式，正在载入义原词典…', W / 2, H / 2)
  }

  /* ---------- 星图 ---------- */
  /* 义原点阵：2168 个 1px 小点。web 版看起来更有体积感，靠的就是这一层 —— 插件里原先漏了 */
  var DUST = null
  function dustOf(core) {
    if (DUST) return DUST
    var xs = core.x
    var m = xs ? (xs.length / 3) | 0 : 0
    DUST = {
      n: m,
      x: new Float32Array(m), y: new Float32Array(m), z: new Float32Array(m),
      px: new Float32Array(m), py: new Float32Array(m), dp: new Float32Array(m)
    }
    for (var i = 0; i < m; i++) {
      DUST.x[i] = xs[i * 3]; DUST.y[i] = xs[i * 3 + 1]; DUST.z[i] = xs[i * 3 + 2]
    }
    return DUST
  }

  /* 三种底色下各有一套墨色：面板永远是霓虹蓝白，页面背景按宿主明暗取「浅蓝白」或「灰黑」 */
  var PAL = {
    neon: { line: [104, 158, 216], dust: [138, 182, 230], node: [158, 202, 246], lit: [170, 224, 255], hot: [246, 252, 255], glow: [20, 52, 92], aL: 0.10, aD0: 0.14, aD1: 0.34, aN0: 0.26, aN1: 0.46, aLit: 0.34 },
    paper: { line: [86, 136, 196], dust: [108, 150, 202], node: [74, 124, 184], lit: [40, 96, 172], hot: [24, 70, 140], glow: [150, 180, 216], aL: 0.20, aD0: 0.30, aD1: 0.42, aN0: 0.42, aN1: 0.44, aLit: 0.50 },
    graphite: { line: [148, 156, 170], dust: [136, 144, 158], node: [162, 170, 184], lit: [190, 198, 210], hot: [214, 220, 230], glow: [120, 128, 142], aL: 0.14, aD0: 0.20, aD1: 0.40, aN0: 0.32, aN1: 0.46, aLit: 0.46 }
  }
  var bgPal = 'neon'
  function pal(which) { return PAL[which] || PAL.neon }
  /* 液态主题：浅底上画深墨，跟「深底画冷光」是同一套结构的反相版本 */
  function drawLiquid(ctx, pts, n, ce, D, held, t, bg, dpr, SK, W, H) {
    var INK = '38,42,52'
    if (bg) {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.46, 10 * dpr, W * 0.5, H * 0.5, Math.min(W, H) * 0.62)
      g.addColorStop(0, 'rgba(206,211,220,.22)')
      g.addColorStop(1, 'rgba(206,211,220,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    // 碎点
    for (var si = 0; si < D.n; si++) {
      var dz = D.dp[si]
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.09 + 0.20 * dz).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(D.px[si], D.py[si], (0.75 + 0.85 * dz) * dpr, 0, 6.2832); ctx.fill()
    }
    // 底网
    ctx.lineWidth = Math.max(0.6, dpr * 0.5)
    for (var e = 0; e < ce.length; e += 2) {
      var a = ce[e], b = ce[e + 1]
      var d = (pts[a * 3 + 2] + pts[b * 3 + 2]) * 0.5
      ctx.strokeStyle = 'rgba(' + INK + ',' + ((bg ? 0.055 : 0.075) + 0.16 * d).toFixed(3) + ')'
      ctx.beginPath()
      ctx.moveTo(pts[a * 3], pts[a * 3 + 1])
      ctx.lineTo(pts[b * 3], pts[b * 3 + 1])
      ctx.stroke()
    }
    // 墨球：远小近大，两层叠出柔边（液体感靠外圈淡、内圈实）
    var ord = []
    for (var oi = 0; oi < n; oi++) ord.push(oi)
    ord.sort(function (u, v) { return pts[u * 3 + 2] - pts[v * 3 + 2] })
    for (var oj = 0; oj < ord.length; oj++) {
      var k = ord[oj], dp = pts[k * 3 + 2]
      var wob = 1 + 0.07 * Math.sin(t / 820 + k * 1.7)
      var r = (1.9 + 2.6 * dp) * dpr * SK * wob
      var x = pts[k * 3], y = pts[k * 3 + 1]
      ctx.fillStyle = 'rgba(' + INK + ',' + ((bg ? 0.09 : 0.11) + 0.13 * dp).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, 6.2832); ctx.fill()
      ctx.fillStyle = 'rgba(' + INK + ',' + ((bg ? 0.26 : 0.30) + 0.34 * dp).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill()
    }
    // 活化：两端都活的边变成涌动的液体管道
    ctx.lineCap = 'round'
    for (var e2 = 0; e2 < ce.length; e2 += 2) {
      var a2 = ce[e2], b2 = ce[e2 + 1]
      var s2 = Math.min(held[a2] || 0, held[b2] || 0)
      if (s2 < 0.10) continue
      var ax = pts[a2 * 3], ay = pts[a2 * 3 + 1], bx = pts[b2 * 3], by = pts[b2 * 3 + 1]
      ctx.strokeStyle = 'rgba(' + INK + ',' + (0.08 + 0.24 * s2).toFixed(3) + ')'
      ctx.lineWidth = (1.1 + 2.0 * s2) * dpr
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      // 液体：沿边流动的墨珠，越活越密越快
      var flow = (t / (900 - 320 * s2)) + (a2 * 0.37 + b2 * 0.71)
      var drops = 1 + Math.floor(s2 * 2.6)
      for (var dq = 0; dq < drops; dq++) {
        var ph = (flow + dq / drops) % 1
        if (ph < 0) ph += 1
        var px = ax + (bx - ax) * ph, py = ay + (by - ay) * ph
        var rr = (2.4 + 3.4 * s2) * dpr * (0.55 + 0.45 * Math.sin(ph * 3.1416))
        ctx.fillStyle = 'rgba(' + INK + ',' + (0.05 + 0.11 * s2).toFixed(3) + ')'
        ctx.beginPath(); ctx.arc(px, py, rr * 2.4, 0, 6.2832); ctx.fill()
        ctx.fillStyle = 'rgba(' + INK + ',' + (0.10 + 0.28 * s2).toFixed(3) + ')'
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.fill()
      }
    }
    // 活化节点：墨球外扩一圈晕
    for (var hk = 0; hk < n; hk++) {
      var v = Math.min(1, held[hk] || 0)
      if (v < 0.10) continue
      var hdp = pts[hk * 3 + 2]
      var hr = (3.0 + 6.0 * Math.sqrt(v)) * (0.85 + 0.3 * hdp) * dpr * SK
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.04 + 0.10 * v).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(pts[hk * 3], pts[hk * 3 + 1], hr * 2.2, 0, 6.2832); ctx.fill()
      ctx.fillStyle = 'rgba(' + INK + ',' + (0.22 + 0.48 * v).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(pts[hk * 3], pts[hk * 3 + 1], hr * 0.55, 0, 6.2832); ctx.fill()
    }
  }

  function drawScene(cv, held, t, rot, scaleK, opts) {
    if (!cv || !cv._w) return
    opts = opts || {}
    var bg = !!opts.bg
    var ctx = cv.getContext('2d')
    var W = cv.width, H = cv.height, dpr = W / cv._w
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)

    var core = window.SEMEME_CORE
    if (!core || !core.cc) return
    var cc = core.cc, ce = core.ce
    var n = (cc.length / 3) | 0
    var ca = Math.cos(rot), sa = Math.sin(rot)
    var SK = (scaleK || 1) * (bg ? 1.35 : 1)

    var pts = new Float32Array(n * 3)
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9
    for (var i = 0; i < n; i++) {
      var x = cc[i * 3], y = cc[i * 3 + 1], z = cc[i * 3 + 2]
      var X = x * ca + z * sa
      var Zm = x * sa - z * ca
      var Y = y * 0.96 - Zm * 0.12
      pts[i * 3] = X; pts[i * 3 + 1] = Y; pts[i * 3 + 2] = Zm
      if (X < minX) minX = X; if (X > maxX) maxX = X
      if (Y < minY) minY = Y; if (Y > maxY) maxY = Y
      if (Zm < minZ) minZ = Zm; if (Zm > maxZ) maxZ = Zm
    }
    // 背景模式不要铺满整个窗口：铺满了 340 个节点就被摊开成散点，密度比面板里差很多
    var padX = bg ? 0.52 : 0.90
    var padY = bg ? 0.80 : 0.90
    var sc = Math.min(W * padX / Math.max(1e-6, maxX - minX), H * padY / Math.max(1e-6, maxY - minY))
    var cx = W / 2 - (minX + maxX) / 2 * sc
    var cy = H / 2 + (minY + maxY) / 2 * sc
    var zSpan = Math.max(1e-6, maxZ - minZ)
    for (var p = 0; p < n; p++) {
      pts[p * 3] = pts[p * 3] * sc + cx
      pts[p * 3 + 1] = cy - pts[p * 3 + 1] * sc
      pts[p * 3 + 2] = (pts[p * 3 + 2] - minZ) / zSpan   // 0=最远 1=最近
    }

    // 点阵投影（用簇的同一套缩放，保证两者重合）
    var D = dustOf(core)
    for (var di = 0; di < D.n; di++) {
      var dxr = D.x[di] * ca + D.z[di] * sa
      var dzr = D.x[di] * sa - D.z[di] * ca
      var dyr = D.y[di] * 0.96 - dzr * 0.12
      D.px[di] = dxr * sc + cx
      D.py[di] = cy - dyr * sc
      D.dp[di] = (dzr - minZ) / zSpan
    }

    // 液态主题走另一套画法（深墨画在浅底上），画完就返回
    if (theme === 'liquid') {
      drawLiquid(ctx, pts, n, ce, D, held, t, bg, dpr, SK, W, H)
      return
    }

    // 冷光底：让节点从深色底里浮起来
    var g0 = ctx.createRadialGradient(W * 0.5, H * 0.46, 10 * dpr, W * 0.5, H * 0.5, Math.min(W, H) * 0.62)
    g0.addColorStop(0, bg ? 'rgba(' + P.glow[0] + ',' + P.glow[1] + ',' + P.glow[2] + ',.24)' : 'rgba(20,48,84,.34)')
    g0.addColorStop(0.6, 'rgba(10,26,48,.16)')
    g0.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g0
    ctx.fillRect(0, 0, W, H)

    var P = bg ? pal(bgPal) : PAL.neon
    var pulse = 0.92 + 0.08 * Math.sin(t / 620)

    // 0) 静息微光：整体先浮一层，别是纯黑底
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = bg ? 'rgba(60,120,190,.045)' : 'rgba(60,120,190,.05)'
    for (var k0 = 0; k0 < n; k0++) {
      ctx.beginPath()
      ctx.arc(pts[k0 * 3], pts[k0 * 3 + 1], 9 * dpr * SK, 0, 6.2832)
      ctx.fill()
    }
    ctx.restore()

    // 1) 网格连线（底网）
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = Math.max(0.6, dpr * 0.55)
    for (var e = 0; e < ce.length; e += 2) {
      var a = ce[e], b = ce[e + 1]
      var d1 = (pts[a * 3 + 2] + pts[b * 3 + 2]) * 0.5
      ctx.strokeStyle = 'rgba(' + P.line[0] + ',' + P.line[1] + ',' + P.line[2] + ',' + (bg ? P.aL : 0.12) + 0.28 * d1.toFixed(3) + ')'
      ctx.beginPath()
      ctx.moveTo(pts[a * 3], pts[a * 3 + 1])
      ctx.lineTo(pts[b * 3], pts[b * 3 + 1])
      ctx.stroke()
    }
    ctx.restore()

    // 2) 义原点阵：撑起体积感的那层碎点
    for (var si = 0; si < D.n; si++) {
      var dz = D.dp[si]
      var rr = (0.95 + 0.95 * dz) * dpr
      var aa = bg ? P.aD0 + P.aD1 * dz : 0.24 + 0.48 * dz
      ctx.fillStyle = 'rgba(' + P.dust[0] + ',' + P.dust[1] + ',' + P.dust[2] + ',' + aa.toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(D.px[si], D.py[si], rr, 0, 6.2832); ctx.fill()
    }

    // 3) 皮层节点（按深度排序，远的先画）
    var ord = []
    for (var oi = 0; oi < n; oi++) ord.push(oi)
    ord.sort(function (u, v) { return pts[u * 3 + 2] - pts[v * 3 + 2] })
    for (var oj = 0; oj < n; oj++) {
      var k = ord[oj], dp = pts[k * 3 + 2]
      var r0 = (1.8 + 2.3 * dp) * dpr * SK
      var a0 = bg ? P.aN0 + P.aN1 * dp : 0.38 + 0.62 * dp
      ctx.fillStyle = 'rgba(' + P.node[0] + ',' + P.node[1] + ',' + P.node[2] + ',' + a0.toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(pts[k * 3], pts[k * 3 + 1], r0, 0, 6.2832); ctx.fill()
    }

    // 4) 点亮：两端都活着的连线先亮，然后节点光晕
    var litArr = held
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (var e2 = 0; e2 < ce.length; e2 += 2) {
      var a2 = ce[e2], b2 = ce[e2 + 1]
      var s2 = Math.min(litArr[a2] || 0, litArr[b2] || 0)
      if (s2 < 0.10) continue
      var dd2 = (pts[a2 * 3 + 2] + pts[b2 * 3 + 2]) * 0.5
      ctx.strokeStyle = 'rgba(' + P.lit[0] + ',' + P.lit[1] + ',' + P.lit[2] + ',' + (P.aLit * s2 * pulse * (0.5 + 0.5 * dd2)).toFixed(3) + ')'
      ctx.lineWidth = (1.0 + 1.2 * s2) * dpr * (bg ? 1.2 : 1)
      ctx.beginPath()
      ctx.moveTo(pts[a2 * 3], pts[a2 * 3 + 1])
      ctx.lineTo(pts[b2 * 3], pts[b2 * 3 + 1])
      ctx.stroke()
    }
    ctx.restore()

    var hotIdx = []
    for (var hk = 0; hk < n; hk++) if ((litArr[hk] || 0) > 0.10) hotIdx.push(hk)
    hotIdx.sort(function (u, v) { return (litArr[u] || 0) - (litArr[v] || 0) })

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (var hi = 0; hi < hotIdx.length; hi++) {
      var kh = hotIdx[hi]
      var v = Math.min(1, litArr[kh] || 0) * pulse
      var dh = pts[kh * 3 + 2]
      var r = (2.6 + 5.2 * Math.sqrt(v)) * (0.88 + 0.30 * dh) * dpr * SK
      var gr = ctx.createRadialGradient(pts[kh * 3], pts[kh * 3 + 1], 0, pts[kh * 3], pts[kh * 3 + 1], r * 4.2)
      gr.addColorStop(0, 'rgba(180,228,255,' + (0.30 * v).toFixed(3) + ')')
      gr.addColorStop(0.35, 'rgba(110,180,245,' + (0.16 * v).toFixed(3) + ')')
      gr.addColorStop(1, 'rgba(60,130,200,0)')
      ctx.fillStyle = gr
      ctx.beginPath(); ctx.arc(pts[kh * 3], pts[kh * 3 + 1], r * 4.2, 0, 6.2832); ctx.fill()
      ctx.fillStyle = 'rgba(' + P.hot[0] + ',' + P.hot[1] + ',' + P.hot[2] + ',' + (0.55 + 0.45 * v).toFixed(3) + ')'
      ctx.beginPath(); ctx.arc(pts[kh * 3], pts[kh * 3 + 1], Math.max(0.6, r * 0.34), 0, 6.2832); ctx.fill()
    }
    ctx.restore()

    if (scaleK > 1) {
      ctx.fillStyle = 'rgba(90,164,255,.35)'
      ctx.font = (11 * dpr) + 'px -apple-system,"Segoe UI",system-ui,sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('形状是隐喻，不是脑活动', 16 * dpr, H - 14 * dpr)
    }
  }

  /* ---------- 多导联波形 ---------- */
  function drawEeg(cv, replay, t) {
    if (!cv || !cv._w) return
    var ctx = cv.getContext('2d')
    var W = cv.width, H = cv.height, dpr = W / cv._w
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)

    var rows = replay.tops.length
    if (!rows) return
    var L = 46 * dpr, R = 8 * dpr, T = 8 * dpr, B = 12 * dpr
    var pw = W - L - R, ph = H - T - B
    var rh = ph / rows

    ctx.strokeStyle = 'rgba(96,150,220,.16)'
    ctx.lineWidth = Math.max(0.5, dpr * 0.5)
    for (var r2 = 0; r2 < rows; r2++) {
      var by = T + rh * (r2 + 0.5)
      ctx.beginPath()
      ctx.moveTo(L, by); ctx.lineTo(L + pw, by)
      ctx.stroke()
    }

    var N = replay.n
    var head = Math.max(2, Math.min(N, (replay.i + 1) * replay.step))
    var colors = [[120, 180, 255], [150, 210, 235], [190, 245, 245], [220, 220, 255],
      [250, 215, 180], [200, 230, 210], [235, 200, 240], [180, 210, 250]]

    for (var c = 0; c < rows; c++) {
      var series = replay.chans[c]
      if (!series) continue
      var y0 = T + rh * (c + 0.5)
      var col = colors[c % colors.length]
      ctx.beginPath()
      ctx.lineWidth = Math.max(0.9, dpr * 0.9)
      ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',.92)'
      for (var x = 0; x < head; x++) {
        var u = x / Math.max(1, N - 1)
        var vy = y0 - series[x] * rh * 1.55
        var px = L + u * pw
        if (x === 0) ctx.moveTo(px, vy); else ctx.lineTo(px, vy)
      }
      ctx.stroke()

      ctx.fillStyle = 'rgba(140,175,210,.75)'
      ctx.font = (9.5 * dpr) + 'px -apple-system,"Segoe UI",system-ui,sans-serif'
      ctx.textAlign = 'right'
      var nm = replay.map && replay.map[replay.tops[c]]
        ? (replay.map[replay.tops[c]][1] || replay.map[replay.tops[c]][0] || '')
        : ''
      ctx.fillText(nm, L - 4 * dpr, y0 + 3 * dpr)
    }
  }

  /* ---------- 指纹卡 ---------- */
  function renderFingerprint(fp) {
    var host = document.getElementById('dsp-fp')
    if (!host || !fp) return
    var top = fp.regions.slice(0, 6)
    var maxShare = Math.max.apply(null, top.map(function (x) { return x.share || 0 }).concat([0.0001]))
    host.innerHTML = top.map(function (r) {
      var pct = Math.round((r.share || 0) * 100)
      var w = Math.max(2, Math.round((r.share || 0) / maxShare * 100))
      return '<div class="dsp-fp"><i title="' + esc(r.name) + '">' + esc(r.name) + '</i>'
        + '<b style="width:' + w + '%"></b><u>' + pct + '%</u></div>'
    }).join('')
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (!document.body) return setTimeout(boot, 60)
    try { window.__dshPulseTheme = theme } catch (x) {}
    // 构建失败不能把整个挂件带走：报错塞进窗口和球的 title，至少还能看出来怎么回事
    try {
      build()
    } catch (e) {
      try {
        window.__dshPulseErr = String((e && e.stack) || e)
        if (btn) btn.title = '挂件初始化失败：' + (e && e.message)
        console.error('[dsh-pulse] build 失败', e)
      } catch (x2) {}
    }
    window.addEventListener('error', function (ev) {
      try { window.__dshPulseErr = String(ev && ev.message) } catch (x3) {}
    })
    requestAnimationFrame(tick)
    setInterval(function () { if (dead()) return; poll(false) }, 2000)
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); toggle() }
      if (e.key === 'Escape' && opened) toggle()
    })
  }

  /* 面板右上角的 ↻：拔掉旧实例、清掉旧 DOM，用时间戳重新拉一份 widget.js。
     改完代码点一下就行，不用重启宿主、也不指望浏览器刷新。 */
  function reloadWidget(ver) {
    try { window.__dshPulseStop && window.__dshPulseStop() } catch (x) {}
    window.__dshPulseLoaded = false
    ;['dsh-pulse-btn', 'dsh-pulse-panel', 'dsh-pulse-bg'].forEach(function (id) {
      var e = document.getElementById(id)
      if (e && e.parentNode) e.parentNode.removeChild(e)
    })
    var st = document.querySelectorAll('style[data-dsh-pulse]')
    for (var i = 0; i < st.length; i++) st[i].parentNode.removeChild(st[i])
    var oldScript = document.querySelector('script[data-dsh-pulse]')
    var host = (oldScript && oldScript.parentNode) || document.body
    if (oldScript && oldScript.parentNode) oldScript.parentNode.removeChild(oldScript)
    var s = document.createElement('script')
    s.src = BASE + '/widget.js?v=' + (ver || Date.now()) + '&t=' + Date.now()
    s.setAttribute('data-dsh-pulse', '1')
    host.appendChild(s)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
