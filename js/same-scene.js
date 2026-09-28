/* SAME SCENE UI — 그룹 상세 안의 "🧬 비슷한 한국/일본 그룹" (SAME_SCENE_DISCOVER_SPEC.md)
 * 계산은 js/idol-recommendation-core.js(window.IdolRec)가 하고, 여기서는 카드만 그린다.
 * SameScene.render(box, { country, name, onOpen(name), mapPage }) */
(function (global) {
  'use strict';
  var COUNTRY = { KR: { label: '한국', page: 'idol-map.html' }, JP: { label: '일본', page: 'idol-map.html' } };
  var MEDALS = ['🥇', '🥈', '🥉'];
  var ACCENT = '#ffd166';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mapUrl(country, name) { return 'idol-map.html?country=' + country + '&group=' + encodeURIComponent(name) + '&scene=1'; }

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
      + '<div class="mpct" aria-label="유사도 ' + m.score + ' 퍼센트"><b>' + m.score + '%</b><span>MATCH</span></div></div>'
      + '<p class="mtags">' + esc(m.tags.join(' · ')) + '</p><p class="mreason">' + esc(m.reasons.join(' ')) + '</p>'
      + '<div class="mact"><button type="button" class="btn out sbtn" data-open="' + label + '" aria-label="' + label + ' 상세보기">상세보기</button>' + sp
      + '<a class="btn out" href="' + mapUrl(c, g.name) + '" aria-label="' + label + ' 지도에서 보기">지도에서 보기</a></div></article>';
  }
  function expandRow(m) {
    var n = esc(m.group.name);
    return '<div class="mgem"><div class="mname">' + n + '<div class="mtags" style="margin:2px 0 0;font-weight:600;color:var(--tx3,#7c7c7c);font-size:11px">' + esc(m.tags.join(' · ')) + '</div></div>'
      + '<div class="gp">' + m.score + '%<small>MATCH</small></div><button type="button" class="mlink" data-open="' + n + '" aria-label="' + n + ' 상세보기">상세보기</button></div>';
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
        + '<a class="scenemap" href="' + mapUrl(c, opts.name) + '" aria-label="지도에서 비슷한 그룹 한눈에 보기">🗺 지도에서 한눈에</a></div>'
        + '<div class="mlist">' + r.top.map(function (m, i) { return card(m, i, c, opts); }).join('') + '</div>';
      if (r.expand.length) {
        h += '<p class="mgemt">🌱 취향 확장 <span style="font-size:11px;font-weight:600;color:var(--tx3,#7c7c7c)">비슷하지만 조금 다른 방향</span></p><div class="mlist" style="gap:8px">' + r.expand.map(expandRow).join('') + '</div>';
      }
      h += '<div class="sfoot"><button type="button" class="scenemap sbtn" data-discover="1" aria-label="다른 그룹 발견하기">🎲 다른 그룹 발견하기</button></div>'
        + '<p class="mnote">스타일 태그·시장 위치(IDOL MAP 논리 좌표)·팬덤·라이브·디지털·대중성·기세를 ' + label + ' 안에서의 상대 위치로 비교한 유사도예요. 점수나 체급 비교가 아니며, 활동종료 그룹은 제외해요.</p>';
      box.innerHTML = h;
    });
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
