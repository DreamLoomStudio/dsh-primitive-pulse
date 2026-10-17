/* 语义脉冲 · 核心算法（无依赖，浏览器与 Node 通用）
 *
 * 输入：HowNet 导出的 sememe-core.json
 *   s: [[en, zh, parentIdx, freq], ...]  2,170 个义原
 *   w: {词: [义原下标...]}                135,009 个词
 *   p: {术语: [义原下标...]}              补录词典
 *
 * 输出：把一段中文压成「义原随时间的激活曲线」。
 */
(function (global) {
  'use strict';

  var CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  var PUNCT = /[\s,.;:!?，。；：！？、""''（）()《》【】\[\]<>·—…~`@#$%^&*+=|\\\/"']/;

  function buildIndex(core) {
    var sem = core.s, w = core.w, p = core.p || {};
    var wordMap = new Map(), maxLen = 1;

    function put(k, v) {
      if (!k || !v || !v.length) return;
      wordMap.set(k, v);
      if (k.length > maxLen) maxLen = k.length;
    }
    for (var k in w) put(k, w[k]);
    for (var t in p) put(t, p[t]);

    // 英文词表单独放：中文最长匹配不能用（长度单位是字符，混进来会抢词）
    var enMap = null;
    if (core.we) {
      enMap = new Map();
      for (var e in core.we) enMap.set(e, core.we[e]);
    }

    // 父链缓存：义原 -> 顶层根义原
    var rootOf = new Int32Array(sem.length).fill(-1);
    function root(i) {
      if (rootOf[i] >= 0) return rootOf[i];
      var cur = i, guard = 0;
      while (sem[cur][2] >= 0 && guard++ < 64) cur = sem[cur][2];
      rootOf[i] = cur;
      return cur;
    }
    for (var i = 0; i < sem.length; i++) root(i);

    // 义原的信息量：被越多词用到的义原越泛（part/entity/human），权重越低。
    // N 只数中文词：英文表是后来补的，混进来会把 idf 整体抬高、改变已校准的调子。
    var N = 0;
    for (var kk in w) N++;
    for (var tt in p) N++;
    var idf = new Float32Array(sem.length), maxIdf = 1;
    var BLOCK = { 'FuncWord': 1, 'DeChinese': 1, 'LeChinese': 1, 'specific': 1, 'alive': 1 };
    for (var j = 0; j < sem.length; j++) {
      if (BLOCK[sem[j][0]]) { idf[j] = 0; continue; }
      var f = Math.max(1, sem[j][3] || 1);
      var v = Math.log(N / f);
      idf[j] = v;
      if (v > maxIdf) maxIdf = v;
    }
    for (var q2 = 0; q2 < idf.length; q2++) if (idf[q2] > 0) idf[q2] = idf[q2] / maxIdf;

    // 数据驱动分区：48 个区来自义原共现的谱聚类（见 packages/core/tests/groups_m0j.py），
    // 不再用 HowNet 那棵断链的分类树。
    var groupOf = core.g ? Int32Array.from(core.g) : null;
    var groupName = core.gn || [];
    if (!groupOf) {
      groupOf = new Int32Array(sem.length);
      for (var i2 = 0; i2 < sem.length; i2++) groupOf[i2] = 0;
    }
    var nGroups = groupName.length || (groupOf.length ? Math.max.apply(null, Array.from(groupOf)) + 1 : 1);

    // 三维布点（义原共现的前三个主成分），星图/脑图直接用
    var pos = core.e ? core.e : null;

    return { sem: sem, wordMap: wordMap, enMap: enMap, maxLen: Math.min(maxLen, 5),
             rootOf: rootOf, root: root, idf: idf,
             groupOf: groupOf, groupName: groupName, nGroups: nGroups, pos: pos,
             // 脑图用的显示粒度：~150 个皮层节点（义原的三维位置聚类），
             // 节点之间的近邻边 ce 只连真正挨着的，网格本身勾出脑形。
             clusters: core.cl || null, centroids: core.cc || null,
             cedges: core.ce || null, regionOf: core.r || null,
             positions: core.x || null,
             outlineLo: core.ol || null, outlineHi: core.oh || null,
             label: function (i) { return groupOf[i]; } };
  }

  /* 最大匹配分词：优先吃掉最长的已知词。
   * 比 jieba 更适合这里——我们只关心「有义原的词」，
   * 词典外的东西本来也拿不到义原。 */
  function segment(text, idx) {
    var out = [], i = 0, n = text.length, maxL = idx.maxLen;
    while (i < n) {
      var ch = text[i];
      if (PUNCT.test(ch)) { i++; continue; }

      // 拉丁字母：先当整词查（HowNet 的英文词表），查不到再按常见词形还原一次
      // （复数 / 第三人称单数 / 过去式 / 进行时 / 副词），最后才记 OOV。
      if (!CJK.test(ch)) {
        var j = i;
        while (j < n && !CJK.test(text[j]) && !PUNCT.test(text[j])) j++;
        var raw = text.slice(i, j);
        var key = raw.toLowerCase().replace(/[^a-z'\-]/g, '');
        var hitE = key ? enLookup(idx, key) : null;
        out.push({ w: raw, s: hitE, oov: !hitE, ch: false });
        i = j;
        continue;
      }

      var hitW = null, hitS = null, L = Math.min(maxL, n - i);
      for (var l = L; l >= 1; l--) {
        var cand = text.slice(i, i + l);
        var s = idx.wordMap.get(cand);
        if (s) { hitW = cand; hitS = s; break; }
      }
      if (hitW) {
        out.push({ w: hitW, s: hitS, oov: false, ch: hitW.length === 1 });
        i += hitW.length;
      } else {
        out.push({ w: ch, s: null, oov: true, ch: true });
        i++;
      }
    }
    return out;
  }

  /* 英文查表：先原形，再按常见词形还原（复数/三单/过去式/进行时/副词/比较级）。
   * HowNet 的英文词表有 4.8 万词，直接查命中率已经不错，词形只是补漏。 */
  function enLookup(idx, key) {
    var m = idx.enMap;
    if (!m) return null;
    var s = m.get(key);
    if (s) return s;
    if (key.length < 4) return null;
    var stems = [];
    if (key.slice(-3) === 'ies') stems.push(key.slice(0, -3) + 'y');
    if (key.slice(-2) === 'es') stems.push(key.slice(0, -2));
    if (key.slice(-3) === 'ing') {
      var b = key.slice(0, -3);
      stems.push(b, b + 'e');
      if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) stems.push(b.slice(0, -1));
    }
    if (key.slice(-2) === 'ed') {
      var b2 = key.slice(0, -2);
      stems.push(b2, key.slice(0, -1));
      if (b2.length > 2 && b2[b2.length - 1] === b2[b2.length - 2]) stems.push(b2.slice(0, -1));
    }
    if (key.slice(-2) === 'ly') stems.push(key.slice(0, -2));
    if (key.slice(-2) === 'er') stems.push(key.slice(0, -2), key.slice(0, -1));
    if (key.slice(-2) === 'st') stems.push(key.slice(0, -2));
    if (key.slice(-1) === 's') stems.push(key.slice(0, -1));
    for (var i = 0; i < stems.length; i++) {
      if (!stems[i] || stems[i].length < 2) continue;
      var v = m.get(stems[i]);
      if (v) return v;
    }
    return null;
  }

  /* 义原流：指数衰减累积，得到类似脑电的多导联曲线。 */
  function stream(tokens, idx, opt) {
    opt = opt || {};
    var decay = opt.decay == null ? 0.72 : opt.decay;
    var topK = opt.topK || 14;
    var n = tokens.length, S = idx.sem.length;

    var act = new Float32Array(S);          // 当前衰减值
    var total = new Float32Array(S);        // 累计强度（用于排名）
    var series = [];                        // 每帧的稀疏 {id: value}
    var litRoot = new Map();

    for (var t = 0; t < n; t++) {
      var ids = tokens[t].s || [];
      for (var q = 0; q < S; q++) act[q] *= decay;

      var base = ids.length ? 1 / Math.sqrt(ids.length) : 0;
      // 单字在 HowNet 里多义严重（把=把手、的=目的、成=成绩），当兜底但不参与统计
      if (tokens[t].ch && !opt.includeChars) base = 0;
      for (var a = 0; a < ids.length; a++) {
        var id = ids[a];
        if (!idx.idf[id]) continue;            // 语法性义原直接跳过
        var wv = base * (0.35 + 0.65 * idx.idf[id]);
        act[id] += wv;
        total[id] += wv;
        var r = idx.rootOf[id];
        litRoot.set(r, (litRoot.get(r) || 0) + wv);
      }

      // 整帧快照（含正在衰减的余量）：曲线才有拖尾，像真的多导联脑电，
      // 而不是每次命中一个尖刺。S=2168，500 token 约 4MB，可接受。
      series.push(act.slice());
    }

    // 排名靠前的义原才画
    var order = [];
    for (var c = 0; c < S; c++) if (total[c] > 0) order.push(c);
    order.sort(function (x, y) { return total[y] - total[x]; });
    var top = order.slice(0, topK);

    var maxV = 0;
    for (var f = 0; f < series.length; f++) {
      for (var id2 of top) {
        var v = series[f][id2] || 0;
        if (v > maxV) maxV = v;
      }
    }

    return {
      tokens: tokens,
      series: series,
      top: top,
      total: total,
      maxV: maxV || 1,
      decay: decay,
      sememes: idx.sem
    };
  }

  /* 指纹：把义原激活汇总到 48 个数据驱动分区，得到一张「构成表」。
   * 分区名不是硬编码的，而是取本段文本里该区最活跃的三个义原拼出来——
   * 这样名字永远贴合当前内容，不会出现一个永恒霸榜的「万物」。 */
  function fingerprint(res, idx) {
    var G = idx.nGroups;
    var gval = new Float64Array(G);
    var members = [];
    for (var g0 = 0; g0 < G; g0++) members.push([]);
    for (var i = 0; i < res.total.length; i++) {
      var v = res.total[i];
      if (!v) continue;
      var g = idx.groupOf[i];
      gval[g] += v;
      members[g].push(i);
    }
    var sum = 0;
    for (var a = 0; a < G; a++) sum += gval[a];
    sum = sum || 1;

    var regions = [];
    for (var b = 0; b < G; b++) {
      if (!gval[b]) continue;
      var ms = members[b].slice().sort(function (x, y) { return res.total[y] - res.total[x]; });
      var names = ms.slice(0, 3).map(function (k) { return idx.sem[k][1]; });
      regions.push({
        g: b,
        name: names.join('·'),
        staticName: idx.groupName[b] || '',
        share: gval[b] / sum,
        value: gval[b],
        top: ms.slice(0, 8)
      });
    }
    regions.sort(function (x, y) { return y.value - x.value; });

    var top = res.top.map(function (i) { return { zh: idx.sem[i][1], en: idx.sem[i][0], v: res.total[i] }; });
    var oov = res.tokens.filter(function (t) { return t.oov; }).length;
    var shareVec = new Float32Array(G);
    for (var c = 0; c < G; c++) shareVec[c] = gval[c] / sum;

    return {
      regions: regions.slice(0, 10),
      shareVec: shareVec,
      top: top.slice(0, 8),
      caption: describe(regions, top),
      stats: {
        tokens: res.tokens.length,
        words: res.tokens.length - oov,
        oov: oov,
        oovRate: res.tokens.length ? oov / res.tokens.length : 0,
        regions: regions.length
      }
    };
  }

  function describe(regions, top) {
    if (!top.length) return "没有提取到任何义原。";
    var names = regions.slice(0, 3).map(function (x) { return x.name; });
    var atoms = top.slice(0, 4).map(function (x) { return "「" + x.zh + "」"; }).join("");
    var pct = Math.round((regions[0] ? regions[0].share : 0) * 100);
    return "重心在 " + names.join(" / ") + "（最高一区占 " + pct + "%）。最活跃的基元："
      + atoms + "。";
  }

  global.PrimitiveCore = {
    buildIndex: buildIndex,
    segment: segment,
    stream: stream,
    fingerprint: fingerprint
  };
})(typeof window !== 'undefined' ? window : globalThis);
