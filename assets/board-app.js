/* 语义脉冲 · 渲染层
 * 脑形星图：2,168 个义原按共现谱的三维坐标，打到「几个椭球并集」的脑形表面上，
 *           每个义原撒成 6 个克隆点形成密集点壳（单层壳从侧面看会碎成弧线）。
 * 基元流：带状曲线，横轴 = 文字推进。
 * 指纹卡：48 个分区排序后的条形 + 基线幽灵，看的是分布形状，不是一根柱子。
 */
(function () {
  'use strict';

  var PC = window.PrimitiveCore;
  var CORE = window.SEMEME_CORE;
  var idx = null;
  var cur = null;
  var base = null, baseAtom = null;
  var hoverI = -1;

  function $(id) { return document.getElementById(id); }

  function fit(cv) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = cv.__w || cv.clientWidth, h = cv.__h || cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function hueOf(g) { return (g * 137.508) % 360; }
  function colOf(g, a, l) {
    return 'hsla(' + hueOf(g).toFixed(0) + ',74%,' + (l || 62) + '%,' + a + ')';
  }

  /* ================= 脑形几何：节点 + 连线 ================= */
  // 两层：2168 个义原点阵（勾出体积和轮廓）+ 340 个皮层节点（亮起来的那层）
  // 节点位置来自 HowNet 语义→脑区映射（packages/core/tests/regions_m0m.py），
  // 边只连真正挨着的节点——脑形完全由网格自己勾出来，不画任何轮廓线。
  var PX = null, PY = null, PZ = null, K = 0, CE = null;   // 皮层节点
  var SLX = null, SLY = null, SLZ = null, NS = 0;          // 义原点阵（屏幕坐标）
  var rotY = -1.30, rotX = 0.13, spin = 0.00022, dragging = false, lastX = 0, lastY = 0;

  function buildGeo() {
    if (!idx || !idx.centroids) { K = 0; return; }
    K = idx.centroids.length / 3;
    PX = new Float32Array(K); PY = new Float32Array(K); PZ = new Float32Array(K);
    CE = (idx.cedges || []).slice();

    var pos = idx.positions || null;
    NS = pos ? (pos.length / 3) : 0;
    SLX = new Float32Array(NS); SLY = new Float32Array(NS); SLZ = new Float32Array(NS);
    SEM_POS = pos;
  }
  var SEM_POS = null;

  function projectAll(W, H) {
    if (!K) return;
    var cc = idx.centroids;
    var ca = Math.cos(rotY), sa = Math.sin(rotY);
    var cb = Math.cos(rotX), sb = Math.sin(rotX);
    var cx = W * 0.5, cy = H * 0.50;
    var k, x, y, z, X, Y, Z, Z2;
    var xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
    var rx = new Float32Array(K), ry = new Float32Array(K);
    for (k = 0; k < K; k++) {
      x = cc[k * 3]; y = cc[k * 3 + 1]; z = cc[k * 3 + 2];
      X = x * ca + z * sa;
      Z = -x * sa + z * ca;
      Y = y * cb - Z * sb;
      Z2 = y * sb + Z * cb;
      rx[k] = X; ry[k] = Y; PZ[k] = Z2;
      if (X < xmin) xmin = X; if (X > xmax) xmax = X;
      if (Y < ymin) ymin = Y; if (Y > ymax) ymax = Y;
    }
    // 自适应铺满画布（留 8% 边距），旋转时不会忽大忽小
    var sc = Math.min((W * 0.92) / ((xmax - xmin) || 1), (H * 0.88) / ((ymax - ymin) || 1));
    var mx = (xmin + xmax) * 0.5, my = (ymin + ymax) * 0.5;
    for (k = 0; k < K; k++) {
      var pp = 1 + 0.07 * PZ[k];
      PX[k] = cx + (rx[k] - mx) * sc * pp;
      PY[k] = cy - (ry[k] - my) * sc * pp;
    }
    // 义原点阵用同一套投影参数，保证点和节点严丝合缝
    var pos = SEM_POS;
    for (var i = 0; i < NS; i++) {
      x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2];
      X = x * ca + z * sa;
      Z = -x * sa + z * ca;
      Y = y * cb - Z * sb;
      Z2 = y * sb + Z * cb;
      var q2 = 1 + 0.07 * Z2;
      SLX[i] = cx + (X - mx) * sc * q2;
      SLY[i] = cy - (Y - my) * sc * q2;
      SLZ[i] = Z2;
    }
  }

  // 每个显示节点承接多少激活
  var HITS = null;
  function clusterHits(res) {
    if (!HITS || HITS.length !== K) HITS = new Float32Array(K);
    else HITS.fill(0);
    var cl = idx.clusters, a = res.total, i;
    for (i = 0; i < cl.length; i++) {
      var v = a[i];
      if (v) HITS[cl[i]] += v;
    }
    var mx = 0;
    for (i = 0; i < K; i++) if (HITS[i] > mx) mx = HITS[i];
    return mx || 1;
  }

  function drawBrain() {
    if (!cur || !K) return;
    var cv = $('brain');
    var f = fit(cv), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    projectAll(W, H);

    var res = cur.res;
    var maxH = clusterHits(res);
    var now = performance.now();

    // 背景的一层冷光，让节点浮起来
    var g0 = ctx.createRadialGradient(W * 0.5, H * 0.46, 10, W * 0.5, H * 0.5, Math.min(W, H) * 0.62);
    g0.addColorStop(0, 'rgba(20,48,84,.34)');
    g0.addColorStop(0.6, 'rgba(10,26,48,.16)');
    g0.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);

    var k, dp, zmin = 1e9, zmax = -1e9;
    for (k = 0; k < K; k++) { if (PZ[k] < zmin) zmin = PZ[k]; if (PZ[k] > zmax) zmax = PZ[k]; }
    var zr = (zmax - zmin) || 1;
    var DEP = new Float32Array(K);
    for (k = 0; k < K; k++) DEP[k] = (PZ[k] - zmin) / zr;

    var lit = new Float32Array(K);
    for (k = 0; k < K; k++) lit[k] = Math.min(1, HITS[k] / maxH);

    // 0) 静息时的微光：让整体先「浮」起来一层，别是纯黑底
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(60,120,190,.05)';
    for (k = 0; k < K; k++) {
      ctx.beginPath(); ctx.arc(PX[k], PY[k], 9, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // 1) 网格连线
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var e, a1, b1, d1;
    for (e = 0; e < CE.length; e += 2) {
      a1 = CE[e]; b1 = CE[e + 1];
      d1 = (DEP[a1] + DEP[b1]) * 0.5;
      ctx.strokeStyle = 'rgba(104,158,216,' + (0.13 + 0.30 * d1).toFixed(3) + ')';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(PX[a1], PY[a1]);
      ctx.lineTo(PX[b1], PY[b1]);
      ctx.stroke();
    }
    ctx.restore();

    // 2) 义原点阵：2168 个 1px 小点，密度撑起体积感
    for (var si = 0; si < NS; si++) {
      var dz = (SLZ[si] - zmin) / zr;
      if (dz < 0) dz = 0; else if (dz > 1) dz = 1;
      var rr = 0.95 + 0.95 * dz;
      var aa = 0.24 + 0.48 * dz;
      ctx.fillStyle = 'rgba(138,182,230,' + aa.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(SLX[si], SLY[si], rr, 0, 6.2832); ctx.fill();
    }

    // 3) 皮层节点
    var ord = [];
    for (k = 0; k < K; k++) ord.push(k);
    ord.sort(function (p, q) { return DEP[p] - DEP[q]; });
    for (var oi = 0; oi < K; oi++) {
      k = ord[oi]; dp = DEP[k];
      var r0 = 1.8 + 2.3 * dp;
      var a0 = 0.38 + 0.62 * dp;
      ctx.fillStyle = 'rgba(158,202,246,' + a0.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(PX[k], PY[k], r0, 0, 6.2832); ctx.fill();
    }

    // 4) 被点亮的节点：亮、有光晕；两个相邻节点都亮，连线也亮
    var pulse = 0.92 + 0.08 * Math.sin(now / 620);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (e = 0; e < CE.length; e += 2) {
      var a2 = CE[e], b2 = CE[e + 1];
      var s2 = Math.min(lit[a2], lit[b2]);
      if (s2 < 0.12) continue;
      ctx.strokeStyle = 'rgba(170,224,255,' + (0.34 * s2 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 1.0 + 1.2 * s2;
      ctx.beginPath();
      ctx.moveTo(PX[a2], PY[a2]);
      ctx.lineTo(PX[b2], PY[b2]);
      ctx.stroke();
    }
    ctx.restore();

    var hotIdx = [];
    for (k = 0; k < K; k++) if (lit[k] > 0.10) hotIdx.push(k);
    hotIdx.sort(function (p, q) { return lit[p] - lit[q]; });

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var hi = 0; hi < hotIdx.length; hi++) {
      k = hotIdx[hi];
      var v = lit[k] * pulse;
      var r = (2.6 + 5.2 * Math.sqrt(v)) * (0.88 + 0.30 * DEP[k]);
      var gr = ctx.createRadialGradient(PX[k], PY[k], 0, PX[k], PY[k], r * 4.2);
      gr.addColorStop(0, 'rgba(180,228,255,' + (0.30 * v).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(110,180,245,' + (0.16 * v).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(60,130,200,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(PX[k], PY[k], r * 4.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(246,252,255,' + (0.55 + 0.45 * v).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(PX[k], PY[k], r * 0.62, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // 5) 最活跃的义原：在它所属节点的位置标一个词
    var top = res.top.slice(0, 6);
    ctx.font = '600 11.5px ui-sans-serif,"PingFang SC","Microsoft YaHei"';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var used = {};
    for (var ti = 0; ti < top.length; ti++) {
      var sid = top[ti], cl = idx.clusters[sid];
      if (used[cl]) continue;
      used[cl] = 1;
      var vv = res.total[sid] / (res.total[res.top[0]] || 1);
      if (vv < 0.12) continue;
      var x = PX[cl], y = PY[cl];
      var tx = x + 12, ty = y - 12;
      ctx.strokeStyle = 'rgba(140,190,240,.42)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx - 4, ty + 4); ctx.stroke();
      ctx.fillStyle = 'rgba(226,240,255,.94)';
      ctx.fillText(idx.sem[sid][1], tx, ty);
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(126,148,176,.55)';
    ctx.font = '11px ui-sans-serif';
    ctx.fillText('拖动旋转 · ' + hotIdx.length + '/' + K + ' 个节点被点亮 · 形状是隐喻，不是脑活动', 14, H - 12);
  }
  /* ================= 基元流 ================= */
  function drawStream() {
    if (!cur) return;
    var cv = $('stream');
    var f = fit(cv), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);

    var res = cur.res, N = res.tokens.length, K = res.top.length;
    var GUT = 92, TOP = 10, BOT = 22;
    var plotW = Math.max(20, W - GUT - 16);
    var px = function (i) { return GUT + (N <= 1 ? plotW / 2 : (i / (N - 1)) * plotW); };

    if (!K) {
      ctx.fillStyle = '#64748b'; ctx.font = '13px ui-sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('没有提取到义原', W / 2, H / 2);
      return;
    }

    var plotW2 = W - GUT - 18;
    var bandH = (H - TOP - BOT) / K;
    var plotH = H - TOP - BOT;

    // 外框 + 记录纸网格：一张表里叠 12 条通道，像脑电图纸
    ctx.strokeStyle = 'rgba(146,176,212,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(GUT + 0.5, TOP + 0.5, plotW2, plotH);

    var k0, by;
    for (k0 = 0; k0 < K; k0++) {
      by = TOP + k0 * bandH + bandH * 0.80;
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(146,176,212,.14)';
      ctx.beginPath(); ctx.moveTo(GUT, by); ctx.lineTo(GUT + plotW2, by); ctx.stroke();
      ctx.restore();
    }
    var stepT = Math.max(1, Math.round(N / 10));
    var gi;
    for (gi = 0; gi < N; gi += stepT) {
      ctx.strokeStyle = 'rgba(146,176,212,.10)';
      ctx.beginPath(); ctx.moveTo(px(gi), TOP); ctx.lineTo(px(gi), TOP + plotH); ctx.stroke();
    }

    for (var k = 0; k < K; k++) {
      var id = res.top[k], g = idx.groupOf[id];
      var base = TOP + k * bandH + bandH * 0.80;
      var amp = bandH * 0.72;
      var col = colOf(g, 1, 72);

      var pts = [];
      for (var i = 0; i < N; i++) {
        var v = (res.series[i][id] || 0) / res.maxV;
        pts.push([px(i), base - v * amp]);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 0; j < pts.length - 1; j++) {
        var p0 = pts[j], p1 = pts[j + 1], mx = (p0[0] + p1[0]) / 2;
        ctx.bezierCurveTo(mx, p0[1], mx, p1[1], p1[0], p1[1]);
      }
      ctx.strokeStyle = col; ctx.lineWidth = 1.35;
      ctx.stroke();

      // 左侧通道标签：色标 + 义原名 + 占比（像 EEG 的 Fp1/T3 通道名）
      ctx.fillStyle = col;
      ctx.fillRect(9, base - 7, 7, 2.5);
      var nm = idx.sem[id][1];
      ctx.fillStyle = 'rgba(214,228,244,.92)';
      ctx.font = '600 10.5px ui-sans-serif,"PingFang SC"';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(nm.length > 6 ? nm.slice(0, 6) : nm, GUT - 9, base - 4);
    }

    if (hoverI >= 0 && hoverI < N) {
      ctx.strokeStyle = 'rgba(226,238,248,.32)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px(hoverI), TOP); ctx.lineTo(px(hoverI), TOP + plotH); ctx.stroke();
      ctx.setLineDash([]);
      var tk = res.tokens[hoverI];
      var label = tk.w.length > 12 ? tk.w.slice(0, 12) : tk.w;
      ctx.font = '11px ui-sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      var tw = ctx.measureText(label).width;
      var lx = Math.min(px(hoverI) + 8, W - tw - 20);
      ctx.fillStyle = 'rgba(6,10,16,.92)';
      ctx.fillRect(lx - 5, TOP + 2, tw + 10, 18);
      ctx.fillStyle = '#cfe6ef';
      ctx.fillText(label, lx, TOP + 6);
    }

    // 时间轴刻度
    ctx.fillStyle = 'rgba(126,146,172,.5)'; ctx.font = '9.5px ui-sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (gi = 0; gi < N; gi += stepT) {
      ctx.fillText(String(gi + 1), px(gi), TOP + plotH + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(110,128,152,.6)'; ctx.font = '10.5px ui-sans-serif';
    ctx.fillText(N + ' token', W - 16, H - 6);
  }

  /* ================= 指纹卡 ================= */
  // 48 个分区的占比排成条形：高的在前，后面跟着基线幽灵条，
  // 一眼能看出「这段在哪几类上比别人重、在哪几类上几乎不碰」。
  function drawComp() {
    if (!cur) return;
    var cv = $('comp');
    var f = fit(cv), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);

    var sv = cur.fp.shareVec || [], G = sv.length;
    if (!G) return;
    var rows = [];
    for (var g = 0; g < G; g++) rows.push({ g: g, v: sv[g] || 0, b: base ? base[g] : 0 });
    rows.sort(function (p, q) { return q.v - p.v; });

    var show = 0;
    for (var z = 0; z < rows.length; z++) if (rows[z].v > 0.004 && show < 10) show++;
    if (show < 6) show = Math.min(6, rows.length);
    var maxV = rows[0].v || 1;
    var top0 = 26, bot = H - 6;
    var rh = (bot - top0) / show;
    var LX = 116, RX = 44;            // 左侧区名宽、右侧百分比宽
    var bx = LX, bw = Math.max(40, W - LX - RX);

    ctx.font = '11px ui-sans-serif,"PingFang SC","Microsoft YaHei"';
    for (var i = 0; i < show && i < rows.length; i++) {
      var r = rows[i];
      var y = top0 + i * rh;
      var cy = y + rh * 0.5;
      // 区名（横排，右对齐到条形左侧）
      var gn = (idx.groupName && idx.groupName[r.g]) || ('区 ' + r.g);
      if (gn.length > 8) gn = gn.slice(0, 8);
      ctx.fillStyle = 'rgba(196,214,236,.88)';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(gn, LX - 8, cy);

      // 条形：灰底槽 + 当前文本 + 基线细线
      var barH = Math.max(7, rh - 6);
      ctx.fillStyle = 'rgba(126,150,186,.10)';
      ctx.fillRect(bx, cy - barH / 2, bw, barH);

      var w1 = Math.max(2, (r.v / maxV) * bw);
      ctx.fillStyle = colOf(r.g, 0.92, 56);
      ctx.fillRect(bx, cy - barH / 2, w1, barH);

      var w2 = Math.max(1, ((r.b || 0) / maxV) * bw);
      ctx.strokeStyle = 'rgba(170,192,220,.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx + w2, cy - barH / 2 - 1.5);
      ctx.lineTo(bx + w2, cy + barH / 2 + 1.5);
      ctx.stroke();

      // 百分比（靠右时画进条内，避免出框）
      var pctTxt = (r.v * 100).toFixed(0) + '%';
      ctx.textAlign = 'left';
      if (bx + w1 + 34 > W) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(12,20,32,.85)';
        ctx.fillText(pctTxt, bx + w1 - 6, cy);
      } else {
        ctx.fillStyle = 'rgba(168,190,216,.80)';
        ctx.fillText(pctTxt, bx + w1 + 6, cy);
      }
    }

    ctx.fillStyle = 'rgba(110,128,152,.75)';
    ctx.font = '10.5px ui-sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('前 ' + show + ' / 共 ' + G + ' 区　彩条=这段文字　竖线=样例平均', 0, 14);
  }

  function drawDev() {
    var box = $('devlist');
    box.innerHTML = '';
    if (!cur || !baseAtom) return;
    var S = idx.sem.length;
    var sum = 0;
    for (var i = 0; i < S; i++) sum += cur.res.total[i];
    sum = sum || 1;

    var rows = [];
    for (var g = 0; g < S; g++) {
      var a = cur.res.total[g] / sum, b = baseAtom[g] || 0;
      if (a < 0.002 && b < 0.002) continue;
      if (!idx.idf[g]) continue;
      rows.push({ i: g, d: a - b });
    }
    rows.sort(function (p, q) { return Math.abs(q.d) - Math.abs(p.d); });
    rows = rows.slice(0, 8);
    if (!rows.length) return;
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.d); })) || 1;

    rows.forEach(function (r) {
      var g = idx.groupOf[r.i];
      var row = document.createElement('div');
      row.className = 'devrow' + (r.d < 0 ? ' neg' : '');
      var pct = (r.d * 100).toFixed(1);
      var w = Math.abs(r.d) / maxAbs * 50;
      var left = r.d >= 0 ? 50 : 50 - w;
      row.innerHTML = '<span class="nm">' + idx.sem[r.i][1] + '</span>' +
        '<span class="track"><i style="left:' + left + '%;width:' + w + '%;background:' +
        (r.d >= 0 ? colOf(g, .95, 58) : 'rgba(126,146,172,.55)') + '"></i></span>' +
        '<span class="pct">' + (r.d > 0 ? '+' : '') + pct + '%</span>';
      box.appendChild(row);
    });
  }

  function describeDev() {
    if (!cur || !baseAtom) return;
    var S = idx.sem.length, sum = 0, i;
    for (i = 0; i < S; i++) sum += cur.res.total[i];
    sum = sum || 1;
    var rows = [];
    for (i = 0; i < S; i++) {
      if (!idx.idf[i]) continue;
      var a = cur.res.total[i] / sum, b = baseAtom[i] || 0;
      if (a < 0.002 && b < 0.002) continue;
      rows.push({ i: i, d: a - b });
    }
    rows.sort(function (p, q) { return q.d - p.d; });
    var up = rows.slice(0, 3).filter(function (r) { return r.d > 0.002; })
      .map(function (r) { return '「' + idx.sem[r.i][1] + '」'; });
    var down = rows.slice(-2).reverse().filter(function (r) { return r.d < -0.002; })
      .map(function (r) { return '「' + idx.sem[r.i][1] + '」'; });
    var s = cur.fp.caption;
    if (up.length) s += ' 比样例基线多 ' + up.join('');
    if (down.length) s += (up.length ? '，' : ' 比样例基线 ') + '少 ' + down.join('');
    $('caption').textContent = s + '。';
  }

  function renderLegend() {
    var box = $('legend');
    box.innerHTML = '';
    if (!cur) return;
    cur.fp.regions.slice(0, 6).forEach(function (r) {
      var el = document.createElement('span');
      el.innerHTML = '<i style="background:' + colOf(r.g, .95, 60) + '"></i>' +
        r.name + ' <span style="color:#4a5a70">' + Math.round(r.share * 100) + '%</span>';
      box.appendChild(el);
    });
  }

  /* ================= 分词证据 ================= */
  function renderChips() {
    var box = $('chips');
    box.innerHTML = '';
    var toks = cur.res.tokens;
    var lim = Math.min(toks.length, 64);
    for (var i = 0; i < lim; i++) {
      var t = toks[i];
      var el = document.createElement('div');
      el.className = 'chip' + (t.oov ? ' oov' : '') + (t.ch ? ' ch' : '');
      var tags;
      if (t.s && t.s.length) {
        tags = t.s.slice(0, 2).map(function (id) { return idx.sem[id][1]; }).join('·');
        if (t.s.length > 2) tags += '+' + (t.s.length - 2);
      } else tags = t.ch ? '单字' : '未收录';
      el.innerHTML = '<b>' + t.w + '</b><i>' + tags + '</i>';
      box.appendChild(el);
    }
    if (toks.length > lim) {
      var more = document.createElement('div');
      more.className = 'chip more';
      more.innerHTML = '<b>…</b><i>还有 ' + (toks.length - lim) + '</i>';
      box.appendChild(more);
    }
  }

  function renderStats() {
    var st = cur.fp.stats;
    $('stats').innerHTML =
      '<span>token <b>' + st.tokens + '</b></span>' +
      '<span>成词 <b>' + st.words + '</b></span>' +
      '<span>未收录 <b>' + (st.oovRate * 100).toFixed(1) + '%</b></span>' +
      '<span>亮起义原 <b>' + countLit() + '</b></span>';
  }
  function countLit() {
    var n = 0;
    for (var i = 0; i < cur.res.total.length; i++) if (cur.res.total[i] > 0) n++;
    return n;
  }

  /* ================= 分析 ================= */
  function analyze(text) {
    var toks = PC.segment(text, idx);
    var res = PC.stream(toks, idx, { topK: 12, decay: 0.72 });
    return { toks: toks, res: res, fp: PC.fingerprint(res, idx) };
  }

  function run(text) {
    if (!text || !text.trim()) return;
    cur = analyze(text);
    hoverI = -1;
    drawBrain(); drawStream(); drawComp(); drawDev(); describeDev();
    renderChips(); renderStats(); renderLegend();
  }

  /* ================= 导出 ================= */
  function saveCard() {
    if (!cur) return;
    var W = 960, H = 1180;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W * .3, 0, 40, W * .3, 0, 760);
    g.addColorStop(0, 'rgba(61,219,230,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#e8eef8'; ctx.font = '700 30px ui-sans-serif,"PingFang SC"';
    ctx.fillText('语义脉冲 · 文本指纹', 48, 66);
    ctx.fillStyle = '#5f7189'; ctx.font = '14px ui-sans-serif';
    ctx.fillText(new Date().toLocaleString('zh-CN'), 48, 94);

    ctx.drawImage(snap($('brain'), drawBrain, 864, 500), 48, 120);
    ctx.drawImage(snap($('comp'), drawComp, 864, 180), 48, 646);

    var y = 880;
    ctx.fillStyle = '#c7d3e4'; ctx.font = '16px ui-sans-serif,"PingFang SC"';
    y = wrap(ctx, $('caption').textContent, 48, y, 864, 27);

    y += 30;
    cur.fp.regions.slice(0, 5).forEach(function (r) {
      ctx.fillStyle = colOf(r.g, .95, 60);
      ctx.fillRect(48, y - 11, 9, 9);
      ctx.fillStyle = '#dbe5f2'; ctx.font = '15px ui-sans-serif,"PingFang SC"';
      ctx.fillText(r.name, 68, y);
      ctx.fillStyle = '#7b8aa3'; ctx.font = '12.5px ui-sans-serif';
      ctx.fillText(Math.round(r.share * 100) + '%', 430, y);
      y += 30;
    });

    ctx.fillStyle = '#36435a'; ctx.font = '12px ui-sans-serif';
    ctx.fillText('HowNet 2,168 义原 · ' + idx.nGroups + ' 个数据驱动分区 · 纯前端，无模型推理', 48, H - 34);

    var a = document.createElement('a');
    a.download = '语义指纹.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  function snap(cv, drawFn, w, h) {
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    cv.__w = w; cv.__h = h;
    drawFn();
    out.getContext('2d').drawImage(cv, 0, 0, w, h);
    delete cv.__w; delete cv.__h;
    drawFn();
    return out;
  }

  function wrap(ctx, text, x, y, maxW, lh) {
    var line = '', yy = y;
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW) { ctx.fillText(line, x, yy); line = text[i]; yy += lh; }
      else line = test;
    }
    ctx.fillText(line, x, yy);
    return yy;
  }

  /* ================= 交互 ================= */
  function wire() {
    $('go').addEventListener('click', function () { run($('input').value); });

    var box = $('samples');
    window.SAMPLES.forEach(function (s) {
      var b = document.createElement('button');
      b.textContent = s.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        $('input').value = s.text;
        run(s.text);
      });
      box.appendChild(b);
    });

    $('input').addEventListener('input', function () {
      clearTimeout(window.__t);
      window.__t = setTimeout(function () { run($('input').value); }, 400);
    });

    $('save').addEventListener('click', saveCard);

    var cv = $('brain');
    cv.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      rotY += (e.clientX - lastX) * 0.008;
      rotX += (e.clientY - lastY) * 0.006;
      rotX = Math.max(-1.15, Math.min(1.15, rotX));
      lastX = e.clientX; lastY = e.clientY;
      drawBrain();
    });
    cv.addEventListener('pointerup', function (e) {
      dragging = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { }
    });
    cv.addEventListener('pointercancel', function () { dragging = false; });

    var sv = $('stream');
    sv.addEventListener('mousemove', function (e) {
      if (!cur) return;
      var r = sv.getBoundingClientRect();
      var GUT = 92, W = r.width;
      var N = cur.res.tokens.length;
      var x = e.clientX - r.left;
      var i = Math.round(((x - GUT) / (W - GUT - 16)) * (N - 1));
      i = Math.max(0, Math.min(N - 1, i));
      if (i !== hoverI) { hoverI = i; drawStream(); }
    });
    sv.addEventListener('mouseleave', function () { hoverI = -1; drawStream(); });

    window.addEventListener('resize', function () {
      clearTimeout(window.__r);
      window.__r = setTimeout(function () {
        if (!cur) return;
        drawBrain(); drawStream(); drawComp(); drawDev();
      }, 140);
    });

    // 自转：限到 ~30fps，别把主线程跑满
    var last = performance.now(), acc = 0;
    function tick(now) {
      var dt = now - last; last = now;
      if (!dragging && cur && !document.hidden) {
        acc += dt;
        rotY += spin * Math.min(3, dt / 16);
        if (acc > 33) { acc = 0; drawBrain(); }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ================= 基线 ================= */
  function buildBaseline() {
    var G = idx.nGroups, S = idx.sem.length;
    var acc = new Float64Array(G), accA = new Float64Array(S), n = 0;
    window.SAMPLES.forEach(function (s) {
      var r = analyze(s.text);
      for (var g = 0; g < G; g++) acc[g] += r.fp.shareVec[g] || 0;
      var sum = 0;
      for (var i = 0; i < S; i++) sum += r.res.total[i];
      sum = sum || 1;
      for (var j = 0; j < S; j++) accA[j] += r.res.total[j] / sum;
      n++;
    });
    var out = new Float32Array(G), outA = new Float32Array(S);
    for (var g2 = 0; g2 < G; g2++) out[g2] = n ? acc[g2] / n : 0;
    for (var i2 = 0; i2 < S; i2++) outA[i2] = n ? accA[i2] / n : 0;
    base = out; baseAtom = outA;
  }

  function boot() {
    idx = PC.buildIndex(CORE);
    buildGeo();
    buildBaseline();
    $('input').value = window.SAMPLES[0].text;
    wire();
    run(window.SAMPLES[0].text);
    if ($('samples').children[0]) $('samples').children[0].classList.add('on');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
