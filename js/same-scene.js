/* SAME SCENE UI — 그룹 상세 안의 "🧬 비슷한 한국/일본 그룹" (SAME_SCENE_DISCOVER_SPEC.md)
 * 계산은 js/idol-recommendation-core.js(window.IdolRec)가 하고, 여기서는 카드만 그린다.
 * SameScene.render(box, { country, name, onOpen(name), mapPage }) */
(function (global) {
  'use strict';
  var COUNTRY = { KR: { label: '한국', page: 'map' }, JP: { label: '일본', page: 'map' } };
  var MEDALS = ['🥇', '🥈', '🥉'];
  var ACCENT = '#ffd166';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var NOPROB = '추천 알고리즘의 상대 유사도 점수이며 확률이 아닙니다.';
  var DEBUG = /[?&]debugMatch=1/.test(location.search);
  // id 를 우선하고 group 이름은 fallback/표시용
  function mapUrl(country, g) {
    var id = g && typeof g === 'object' ? g.id : '', name = g && typeof g === 'object' ? g.name : g;
    return 'map?country=' + country + (id ? '&id=' + encodeURIComponent(id) : '') + '&group=' + encodeURIComponent(name) + '&scene=1';
  }
  function flags(m) {
    return (m.limited ? '<span class="chip mid" title="데이터가 일부 부족하거나 검증이 덜 된 그룹이에요">데이터 제한</span> ' : '')
      + '<span class="mconf" title="결과 신뢰도(데이터 완성도×검증상태)">신뢰도 ' + esc(m.confidenceLabel) + '</span>';
  }
  function dbg(m) {
    if (!DEBUG || !m.debug) return '';
    return '<pre class="mlog dbgm">' + esc('점수 base ' + m.debug.base + ' + 보정 ' + m.debug.bonus + ' · 가중치 ' + JSON.stringify(m.debug.usedWeights) + '\n결측 ' + JSON.stringify(m.debug.missing)
      + ' · coverage ' + m.debug.coverage + ' · confidence ' + m.debug.confidence + '\n보정점수 ' + m.debug.rankingScore + ' · 다양성 감점 ' + m.debug.diversityPenalty + ' · tie-break ' + m.debug.tieBreak
      + '\n' + Object.keys(m.breakdown).map(function (k) { return k + ' ' + (m.breakdown[k] === null ? '—' : Math.round(m.breakdown[k])); }).join(' · ')) + '</pre>';
  }

  var css = '.scenebox{margin-top:22px;padding-top:20px;border-top:1px solid #2a2a2a}'
    + '.scenebox .mpct b{color:' + ACCENT + '}'
    + '.scenebox .mcard{box-shadow:inset 0 0 0 1px rgba(255,209,102,.16)}'
    + '.scenebox .mtitle .sub2{letter-spacing:.08em}'
    + '.scenehead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px}'
    + '.scenehead .mtitle{margin:0}'
    + '.scenemap{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:9999px;font-size:12px;font-weight:700;color:var(--tx,#fff);box-shadow:inset 0 0 0 1px var(--bdl,#7c7c7c);text-decoration:none}'
    + '.scenemap:hover{background:rgba(255,255,255,.06)}'
    + '.scenebox .sbtn{min-height:44px;font-family:inherit;cursor:pointer;border:0;background:transparent;color:var(--tx,#fff)}'
    + '.scenebox .sbtn:focus-visible,.scenemap:focus-visible,.scenebox .mlink:focus-visible,.scenebox .mact .btn:focus-visible{outline:2px solid ' + ACCENT + ';outline-offset:2px}'
    + '.scenebox .mgem{cursor:default}'
    + '.scenebox .mgem .gp{color:' + ACCENT + '}'
    + '.scenebox .mgem button.mlink{font-family:inherit;cursor:pointer;border:0;background:transparent}'
    + '.scenebox .sfoot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}'
    + '@media(min-width:640px){.scenebox .mlist.snap{grid-template-columns:none}}';

  function injectCss() {
    if (document.getElementById('sceneCss')) return;
    var st = document.createElement('style'); st.id = 'sceneCss'; st.textContent = css; document.head.appendChild(st);
  }

  function card(m, i, c, opts) {
    var g = m.group, label = esc(g.name);
    var sp = g.spotify ? '<a class="btn grn" target="_blank" rel="noopener noreferrer" href="' + esc(g.spotify) + '" aria-label="' + label + ' Spotify에서 듣기">Spotify ▶</a>' : '';
    return '<article class="mcard"><div class="mtop"><span class="mmedal" aria-hidden="true">' + MEDALS[i] + '</span><div class="mname">' + label + '</div>'
      + '<div class="mpct" title="' + NOPROB + '" aria-label="유사도 ' + m.score + '점. ' + NOPROB + '"><b>' + m.score + '</b><span>MATCH</span></div></div>'
      + '<p class="mtags">' + esc(m.tags.join(' · ')) + '</p><p class="mreason">' + esc(m.reasons.join(' ')) + '</p><p class="mflags">' + flags(m) + '</p>' + dbg(m)
      + '<div class="mact"><button type="button" class="btn out sbtn" data-open="' + label + '" aria-label="' + label + ' 상세보기">상세보기</button>' + sp
      + '<a class="btn out" href="' + mapUrl(c, g) + '" aria-label="' + label + ' 지도에서 보기">지도에서 보기</a></div></article>';
  }
  function expandRow(m) {
    var n = esc(m.group.name);
    return '<div class="mgem"><div class="mname">' + n + '<div class="mtags" style="margin:2px 0 0;font-weight:600;color:var(--tx3,#7c7c7c);font-size:11px">' + esc(m.tags.join(' · ')) + '</div></div>'
      + '<div class="gp" title="' + NOPROB + '" aria-label="유사도 ' + m.score + '점">' + m.score + '<small>MATCH</small></div><button type="button" class="mlink" data-open="' + n + '" aria-label="' + n + ' 상세보기">상세보기</button></div>';
  }

  function render(box, opts) {
    injectCss();
    var IM = global.IdolMatch, R = global.IdolRec;
    if (!IM || !R) { box.innerHTML = ''; return; }
    var c = opts.country, label = COUNTRY[c].label;
    box.classList.add('scenebox');
    IM.ready.then(function () {
      if (!box.isConnected || box.dataset.n !== opts.name) return;
      var r = R.getSameSceneMatches(c, opts.name, { limit: 3, expandLimit: 3 });
      if (!r || !r.top.length) { box.innerHTML = ''; return; }
      var h = '<div class="scenehead"><h3 class="mtitle">🧬 비슷한 ' + label + ' 그룹 <span class="sub2">SAME SCENE</span></h3>'
        + '<a class="scenemap" href="' + mapUrl(c, { id: opts.id, name: opts.name }) + '" aria-label="지도에서 비슷한 그룹 한눈에 보기">🗺 지도에서 한눈에</a></div>'
        + '<div class="mlist">' + r.top.map(function (m, i) { return card(m, i, c, opts); }).join('') + '</div>';
      if (r.expand.length) {
        h += '<p class="mgemt">🌱 취향 확장 <span style="font-size:11px;font-weight:600;color:var(--tx3,#7c7c7c)">비슷하지만 조금 다른 방향</span></p><div class="mlist" style="gap:8px">' + r.expand.map(expandRow).join('') + '</div>';
      }
      h += '<div class="sfoot"><button type="button" class="scenemap sbtn" data-discover="1" aria-label="다른 그룹 발견하기">🎲 다른 그룹 발견하기</button></div>'
        + '<p class="mnote">스타일 태그, 시장 성향(팬덤·라이브·디지털·대중성 4축을 한 번의 거리로 계산), 현재기세, 체급을 ' + label + ' 안에서의 상대 위치로 비교한 유사도예요. MATCH 숫자는 ' + NOPROB + ' 활동종료 그룹은 제외하고, 데이터가 없는 항목은 계산에서 빼요.</p>';
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<p class="mnote">비슷한 그룹을 불러오지 못했어요. 새로고침해 주세요.</p>'; });
    if (!box._sceneBound) {
      box._sceneBound = true;
      box.addEventListener('click', function (e) {
        var o = e.target.closest('[data-open]');
        if (o && typeof opts.onOpen === 'function') { e.preventDefault(); opts.onOpen(o.getAttribute('data-open')); return; }
      });
    }
  }

  global.SameScene = { render: render, mapUrl: mapUrl };
})(window);
