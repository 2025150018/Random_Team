// 랜덤 팀 배정 — 연출 포함
(() => {
  const $ = (id) => document.getElementById(id);

  const TEAM_COLORS = [
    '#ff7a7a', '#5ec8ff', '#7be08a', '#ffcc33', '#c58bff', '#ff9f43',
    '#4be0c8', '#ff7ac8', '#a3e635', '#93a5ff', '#f472b6', '#facc15',
    '#2dd4bf', '#fb923c', '#a78bfa', '#38bdf8', '#86efac', '#fda4af',
    '#fde047', '#67e8f9', '#d8b4fe', '#fdba74', '#bef264', '#7dd3fc',
    '#f9a8d4', '#99f6e4', '#c4b5fd', '#fcd34d', '#6ee7b7', '#e879f9',
  ];

  let runId = 0;          // 실행 토큰: 바뀌면 진행 중인 연출을 중단
  let result = null;      // { people: string[], teams: number[][] }  (teams[t] = people 인덱스 목록)
  let speed = 1;

  // ---------- 랜덤 ----------
  function randInt(n) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // fixed[t] = t팀에 미리 고정한 사람 인덱스 목록.
  // 고정되지 않은 사람은 무작위 순서로, 그때그때 인원이 가장 적은 팀(동률이면 무작위)에 넣는다.
  // 공개 순서는 전체를 섞어서 고정 인원이 따로 티 나지 않게 한다.
  function makeAssignment(peopleCount, teamCount, fixed = []) {
    const teams = Array.from({ length: teamCount }, (_, t) => (fixed[t] || []).slice());
    const used = new Set(teams.flat());
    const rest = shuffle([...Array(peopleCount).keys()].filter((p) => !used.has(p)));
    for (const p of rest) {
      const min = Math.min(...teams.map((m) => m.length));
      const cands = teams.map((_, i) => i).filter((i) => teams[i].length === min);
      teams[cands[randInt(cands.length)]].push(p);
    }
    const reveal = shuffle(teams.flatMap((m, t) => m.map((p) => ({ person: p, team: t }))));
    // 결과 바로 보기에서도 팀 안 순서가 공개 순서와 같도록 다시 만든다
    const ordered = Array.from({ length: teamCount }, () => []);
    reveal.forEach(({ person, team }) => ordered[team].push(person));
    return { teams: ordered, reveal };
  }

  // ---------- 미리 정한 배정 ----------
  const PRESET_KEY = 'teamRandomizer.preset';
  function loadPreset() {
    try { return localStorage.getItem(PRESET_KEY) || ''; } catch (_) { return ''; }
  }
  function storePreset(text) {
    try {
      if (text) localStorage.setItem(PRESET_KEY, text);
      else localStorage.removeItem(PRESET_KEY);
    } catch (_) { /* 저장 불가 환경: 이번 접속 동안만 유지 */ }
  }
  let presetText = loadPreset();

  // 설정 문장을 현재 인원·팀 수에 맞춰 해석한다. { fixed } 또는 { error }
  function parsePreset(text, people, teamCount) {
    const fixed = Array.from({ length: teamCount }, () => []);
    const seen = new Map();
    const seenTok = new Map();   // 같은 사람을 두 팀에 적은 실수는 명단과 상관없이 잡는다
    const errors = [];
    const missing = [];          // 지금 명단에 없는 사람 → 무시하고, 나중에 명단에 생기면 적용
    const missingTeams = [];     // 지금 팀 수보다 큰 팀 → 무시하고, 팀 수를 늘리면 적용
    const lines = text.split('\n');
    let lineTeam = 0;
    for (const raw of lines) {
      let line = raw.trim();
      let t = lineTeam;
      const m = line.match(/^(\d+)\s*팀\s*[:：]?\s*/);
      if (m) { t = parseInt(m[1], 10) - 1; line = line.slice(m[0].length); }
      lineTeam++;
      if (!line) continue;
      const teamOk = t >= 0 && t < teamCount;
      if (!teamOk) missingTeams.push(t + 1);
      for (const tok of line.split(/[,，\s]+/).filter(Boolean)) {
        const key = tok.replace(/^(\d+)번$/, '$1');
        if (seenTok.has(key)) { errors.push(`'${tok}'이(가) ${seenTok.get(key) + 1}팀과 ${t + 1}팀에 중복됩니다.`); continue; }
        seenTok.set(key, t);
        let idx = people.indexOf(tok);
        if (idx < 0) {
          const num = tok.match(/^(\d+)번?$/);
          if (num) idx = parseInt(num[1], 10) - 1;
        }
        if (idx < 0 || idx >= people.length) { missing.push(tok); continue; }
        if (seen.has(idx)) { errors.push(`'${people[idx]}'이(가) ${seen.get(idx) + 1}팀과 ${t + 1}팀에 중복됩니다.`); continue; }
        seen.set(idx, t);
        if (teamOk) fixed[t].push(idx);
      }
    }
    if (errors.length) return { error: errors.join('\n') };
    const count = fixed.reduce((n, mm) => n + mm.length, 0);
    return { fixed, count, missing, missingTeams };
  }

  // ---------- 유틸 ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed));
  const alive = (id) => id === runId;

  function makeChip(label) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.textContent = label;
    return el;
  }

  function readInput() {
    const names = $('names').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const teamCount = parseInt($('teams').value, 10);
    let people;
    if (names.length) {
      people = names;
    } else {
      const n = parseInt($('people').value, 10);
      if (!Number.isFinite(n) || n < 2) return { error: '인원수는 2명 이상이어야 합니다.' };
      if (n > 300) return { error: '인원수는 300명까지 가능합니다.' };
      people = Array.from({ length: n }, (_, i) => `${i + 1}번`);
    }
    if (!Number.isFinite(teamCount) || teamCount < 2) return { error: '팀 수는 2팀 이상이어야 합니다.' };
    if (teamCount > 30) return { error: '팀 수는 30팀까지 가능합니다.' };
    if (teamCount > people.length) return { error: '팀 수가 인원수보다 많을 수 없습니다.' };
    return { people, teamCount };
  }

  // ---------- 화면 구성 ----------
  function buildStage(people, teamCount) {
    const pool = $('pool');
    pool.innerHTML = '';
    people.forEach((name, i) => {
      const c = makeChip(name);
      c.dataset.idx = i;
      pool.appendChild(c);
    });
    $('poolTitle').textContent = `대기 중 (${people.length}명)`;

    const box = $('teamsBox');
    box.innerHTML = '';
    for (let t = 0; t < teamCount; t++) {
      const el = document.createElement('div');
      el.className = 'team';
      el.style.setProperty('--team-color', TEAM_COLORS[t % TEAM_COLORS.length]);
      el.innerHTML = `<h3><span>${t + 1}팀</span><span class="count">0명</span></h3><div class="members"></div>`;
      box.appendChild(el);
    }
  }

  function setAnnounce(html) {
    const a = $('announce');
    a.innerHTML = html;
    a.classList.remove('bump');
    void a.offsetWidth;
    a.classList.add('bump');
  }

  // ---------- 연출 ----------
  async function countdown(id) {
    const ov = $('overlay');
    ov.classList.add('show');
    for (const n of ['3', '2', '1']) {
      if (!alive(id)) break;
      ov.innerHTML = `<span>${n}</span>`;
      await new Promise((r) => setTimeout(r, 750));
    }
    ov.classList.remove('show');
    ov.innerHTML = '';
  }

  // 후보들 사이를 깜빡이며 돌다가 점점 느려지며 target에 멈추는 룰렛
  async function roulette(id, elements, target, steps, cls) {
    if (elements.length <= 1) steps = 1;
    let prev = null;
    for (let i = 0; i < steps; i++) {
      if (!alive(id)) return;
      let el;
      if (i === steps - 1) el = target;
      else {
        do { el = elements[randInt(elements.length)]; } while (el === prev && elements.length > 1);
      }
      if (prev) prev.classList.remove(cls);
      el.classList.add(cls);
      prev = el;
      const progress = i / Math.max(1, steps - 1);
      await wait(45 + progress * progress * 220);
    }
  }

  async function flyChip(id, fromEl, teamEl, label, color) {
    const list = teamEl.querySelector('.members');
    const placeholder = makeChip(label);
    placeholder.style.visibility = 'hidden';
    placeholder.style.background = color;
    list.appendChild(placeholder);

    const a = fromEl.getBoundingClientRect();
    const b = placeholder.getBoundingClientRect();
    const ghost = makeChip(label);
    ghost.classList.add('ghost');
    Object.assign(ghost.style, {
      left: `${a.left}px`, top: `${a.top}px`,
      width: `${a.width}px`, height: `${a.height}px`,
      background: color, color: '#111',
    });
    document.body.appendChild(ghost);
    fromEl.classList.remove('flash');
    fromEl.classList.add('taken');

    const dx = b.left - a.left;
    const dy = b.top - a.top;
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.6) rotate(8deg)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)` },
    ], { duration: Math.max(120, 650 * speed), easing: 'cubic-bezier(.5,0,.3,1)' });

    try { await anim.finished; } catch (_) { /* 취소됨 */ }
    ghost.remove();
    if (!alive(id)) return;
    placeholder.style.visibility = '';
    placeholder.classList.add('pop');
  }

  function updateCounts(remaining) {
    document.querySelectorAll('.team').forEach((el) => {
      el.querySelector('.count').textContent = `${el.querySelectorAll('.members .chip').length}명`;
    });
    $('poolTitle').textContent = remaining > 0 ? `대기 중 (${remaining}명)` : '배정 완료!';
  }

  async function run() {
    const input = readInput();
    $('error').textContent = input.error || '';
    if (input.error) return;
    const { people, teamCount } = input;

    let fixed = [];
    if (presetText.trim()) {
      const p = parsePreset(presetText, people, teamCount);
      if (p.error) {
        // 화면에는 자세한 내용을 드러내지 않는다
        $('error').textContent = '설정을 다시 확인해 주세요.';
        return;
      }
      fixed = p.fixed;
    }

    const id = ++runId;
    speed = parseFloat($('speed').value) || 1;
    const { teams, reveal } = makeAssignment(people.length, teamCount, fixed);
    result = { people, teams };

    buildStage(people, teamCount);
    setAnnounce('');
    setRunning(true);

    await countdown(id);

    const poolChips = [...$('pool').children];
    const teamEls = [...$('teamsBox').children];
    const total = reveal.length;

    for (let i = 0; i < total; i++) {
      if (!alive(id)) return;
      const { person, team } = reveal[i];
      const remaining = poolChips.filter((c) => !c.classList.contains('taken'));
      const isLast = i === total - 1;
      // 처음 몇 명과 마지막 사람은 더 길게, 중간은 점점 빠르게
      const drama = i < 3 || isLast ? 1.6 : Math.max(0.6, 1 - i / total);

      await roulette(id, remaining, poolChips[person], Math.round(10 * drama), 'flash');
      if (!alive(id)) return;

      setAnnounce(`<span>${people[person]}</span><span class="arrow">→</span><span>?</span>`);
      await roulette(id, teamEls, teamEls[team], Math.round(9 * drama), 'flash');
      if (!alive(id)) return;

      const color = TEAM_COLORS[team % TEAM_COLORS.length];
      setAnnounce(`<span>${people[person]}</span><span class="arrow">→</span><span style="color:${color}">${team + 1}팀!</span>`);
      await flyChip(id, poolChips[person], teamEls[team], people[person], color);
      teamEls[team].classList.remove('flash');
      updateCounts(total - i - 1);
      await wait(isLast ? 300 : 120);
    }

    if (!alive(id)) return;
    finish();
  }

  // 연출 없이 최종 결과 바로 표시
  function showFinal() {
    if (!result) return;
    runId++;
    document.querySelectorAll('.chip.ghost').forEach((g) => g.remove());
    $('overlay').classList.remove('show');
    const { people, teams } = result;
    buildStage(people, teams.length);
    [...$('pool').children].forEach((c) => c.classList.add('taken'));
    const teamEls = [...$('teamsBox').children];
    teams.forEach((members, t) => {
      const list = teamEls[t].querySelector('.members');
      members.forEach((p) => {
        const c = makeChip(people[p]);
        c.style.background = TEAM_COLORS[t % TEAM_COLORS.length];
        list.appendChild(c);
      });
    });
    updateCounts(0);
    finish();
  }

  function finish() {
    setAnnounce('🎉 배정 완료! 🎉');
    setRunning(false);
    $('copyBtn').disabled = false;
    confetti();
  }

  function setRunning(on) {
    $('startBtn').disabled = on;
    $('skipBtn').disabled = !on;
    $('copyBtn').disabled = true;
    ['people', 'teams', 'speed', 'names'].forEach((k) => ($(k).disabled = on));
    $('startBtn').textContent = on ? '배정 중…' : '다시 배정';
  }

  function reset() {
    runId++;
    result = null;
    document.querySelectorAll('.chip.ghost').forEach((g) => g.remove());
    $('overlay').classList.remove('show');
    $('pool').innerHTML = '';
    $('teamsBox').innerHTML = '';
    $('poolTitle').textContent = '';
    $('announce').innerHTML = '';
    $('error').textContent = '';
    setRunning(false);
    $('startBtn').textContent = '배정 시작';
  }

  async function copyResult() {
    if (!result) return;
    const text = result.teams
      .map((m, t) => `${t + 1}팀 (${m.length}명): ${m.map((p) => result.people[p]).join(', ')}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      $('copyBtn').textContent = '복사됨!';
    } catch (_) {
      window.prompt('아래 내용을 복사하세요', text);
    }
    setTimeout(() => ($('copyBtn').textContent = '결과 복사'), 1500);
  }

  // ---------- 꽃가루 ----------
  function confetti() {
    const cv = $('confetti');
    const ctx = cv.getContext('2d');
    cv.width = innerWidth;
    cv.height = innerHeight;
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      vx: -2 + Math.random() * 4,
      vy: 2 + Math.random() * 4,
      r: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
      c: TEAM_COLORS[randInt(TEAM_COLORS.length)],
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (now - start < 4000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    })(start);
  }

  // ---------- 숨김 설정 창 ----------
  function checkPreset(text) {
    const st = $('presetStatus');
    if (!text.trim()) {
      st.className = 'status';
      st.textContent = '설정 없음: 완전 무작위로 배정됩니다.';
      return true;
    }
    // 명단·팀 수가 아직 없거나 맞지 않아도 저장은 할 수 있다 (같은 사람 중복만 막음)
    const input = readInput();
    const people = input.error ? [] : input.people;
    const teamCount = input.error ? 0 : input.teamCount;
    const p = parsePreset(text, people, teamCount);
    if (p.error) {
      st.className = 'status bad';
      st.textContent = p.error;
      return false;
    }
    const notes = [];
    if (input.error) {
      notes.push(`지금 입력된 인원/팀 수로는 확인할 수 없어요 (${input.error}). 저장은 됩니다.`);
    } else {
      notes.push(`지금 기준 ${p.count}명 고정 (${people.length}명 / ${teamCount}팀)`);
      if (p.missing.length) notes.push(`※ 지금 명단에 없음: ${p.missing.join(', ')} → 명단에 생기면 적용, 없으면 무시`);
      if (p.missingTeams.length) notes.push(`※ 지금 없는 팀: ${[...new Set(p.missingTeams)].join(', ')}팀 → 팀 수를 늘리면 적용, 아니면 무시`);
      const maxBalanced = Math.ceil(people.length / teamCount);
      if (p.fixed.some((m) => m.length > maxBalanced)) {
        notes.push(`※ 한 팀에 ${maxBalanced}명보다 많이 고정되어 팀 인원이 고르지 않게 됩니다.`);
      }
    }
    st.className = 'status ok';
    st.textContent = notes.join('\n');
    return true;
  }

  function openPreset() {
    if (!$('skipBtn').disabled) return; // 배정 연출 중에는 열지 않음
    $('presetText').value = presetText;
    checkPreset(presetText);
    $('preset').classList.add('show');
    $('presetText').focus();
  }
  function closePreset() { $('preset').classList.remove('show'); }

  $('dice').addEventListener('click', (e) => { if (e.detail === 3) openPreset(); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); openPreset(); }
    else if (e.key === 'Escape') closePreset();
  });
  $('presetText').addEventListener('input', () => checkPreset($('presetText').value));
  $('presetSave').addEventListener('click', () => {
    const text = $('presetText').value;
    if (!checkPreset(text)) return;
    presetText = text;
    storePreset(text);
    $('error').textContent = '';
    closePreset();
  });
  $('presetClear').addEventListener('click', () => {
    $('presetText').value = '';
    presetText = '';
    storePreset('');
    checkPreset('');
  });
  $('presetClose').addEventListener('click', closePreset);

  // ---------- 이벤트 ----------
  $('startBtn').addEventListener('click', run);
  $('skipBtn').addEventListener('click', showFinal);
  $('copyBtn').addEventListener('click', copyResult);
  $('resetBtn').addEventListener('click', reset);
})();
