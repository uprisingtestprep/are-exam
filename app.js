/* ARE Exam Simulator, Application Logic */

const ACCESS_CODE  = "ARE9000";
const CLUSTER_LABEL = "Case Study";
// ARE 5.0 is 6 separate real exams (divisions), each with its own real item
// count, time limit, and disclosed pass threshold -- see divisions.js. These
// four are no longer fixed constants: setupDivisionGate() sets them from the
// division the candidate actually picks, before startExam() ever runs.
let EXAM_SECONDS = 9600;
let PASSING_PCT  = 65;
let STORAGE_KEY  = "are_exam_state_v1";
let SIM_Q_COUNT  = 65;
let CURRENT_DIVISION = null;
// Full Pool Drill: a second practice mode alongside the real-exam-length
// sitting above. Instead of a random real_item_count draw, a division here
// serves EVERY simulator-exclusive question it has, and divisions unlock in
// order -- finish one before the next is selectable. There is no real NCARB
// time limit for this (the real exam is only 65-100 items), so every
// division uses the same flat, disclosed practice timer, not a real figure.
let DRILL_MODE = false;
const DRILL_TIMER_SECONDS = 12600; // 3h30m flat, same for every division
const DOMAIN_LABELS = {"business_operations": "Business Operations", "finances_risk_and_development_of_practice": "Finances Risk and Development of Practice", "practice_wide_delivery_of_services": "Practice-Wide Delivery of Services", "practice_methodologies": "Practice Methodologies"};  // maps domain key -> human-readable label for display
function domainLabel(key) { return DOMAIN_LABELS[key] || key || ""; }

// Question types: "mcq" (default, single-select) or "sata" (check-all-that-
// apply, multi-select, ARE 5.0's real term for this item type across all 6
// divisions). sataIsCorrect requires an EXACT set match (no partial credit),
// matching NCARB's own real scoring rule for this item type.
const SATA_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];
function qType(q) { return q?.type || "mcq"; }
function sataIsCorrect(userAns, correctArr) {
  const u = Array.isArray(userAns) ? userAns : [];
  const c = Array.isArray(correctArr) ? correctArr : [];
  return u.length === c.length && u.every(l => c.includes(l));
}

let questions = [];
let state = {
  phase: "gate", answers: {}, flags: {},
  current: 1, timeLeft: EXAM_SECONDS,
  submitted: false, startTime: null,
};
let timerInterval = null;

// ── boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("access-gate").style.display = "flex";
  document.getElementById("app").style.display = "none";
  setupAccessGate();
  paintPoolBanners();
});

// The division picker only ever shows one division's real-exam item count
// (65, 75, 100...) at a time, which candidates could add up to 490 and
// mistake for the whole product's content. This states the true, EXACT
// totals instead -- book and simulator counted separately, since they are
// genuinely two different sets of questions with zero overlap (see
// sim_excludes_book_questions in config.json) -- on both the access gate
// (the very first screen anyone sees) and the mode-selection gate.
function paintPoolBanners() {
  const bookTotal = window.BOOK_TOTAL || 0;
  const simTotal = (window.EXAM_QUESTIONS || []).length;
  const grandTotal = bookTotal + simTotal;
  const divCount = (window.DIVISIONS || []).length;
  const gateLine = document.getElementById("gate-pool-line");
  if (gateLine) gateLine.textContent = `${grandTotal.toLocaleString()} total practice questions: ${bookTotal.toLocaleString()} in your printed book plus ${simTotal.toLocaleString()} more online across all ${divCount} divisions, and none of them repeat`;
  const poolNum = document.getElementById("pool-banner-num");
  const poolLabel = document.getElementById("pool-banner-label");
  if (poolNum) poolNum.textContent = grandTotal.toLocaleString();
  if (poolLabel) poolLabel.textContent = `total practice questions across the book and the simulator. ${bookTotal.toLocaleString()} are already printed in your book. The other ${simTotal.toLocaleString()} are simulator-exclusive, spread across all ${divCount} divisions, and never repeat what's printed.`;
}

// Shuffle by UNIT, never by individual question. A cluster is several
// questions sharing one case or passage: they must stay together and in their
// authored order, because later questions refer back to the same material.
// Shuffling every question individually scatters them across the exam, so a
// candidate meets question 6 about a passage before ever seeing the passage.
// That bug reached CNPLE's LIVE site and only a real browser found it.
// Truncation is done on a unit boundary too, so a cluster is never cut in half.
function clusterId(q) {
  return q.cluster_id || q.case_id || q.passage_id || null;
}

function pickQuestions(all, limit) {
  const units = [], byId = new Map();
  for (const q of all) {
    const c = clusterId(q);
    if (!c) { units.push([q]); continue; }
    if (!byId.has(c)) { const u = []; byId.set(c, u); units.push(u); }
    byId.get(c).push(q);
  }
  shuffleUnits(units);

  const out = [];
  for (const u of units) {
    if (out.length + u.length > limit) continue;   // never split a cluster
    for (const q of u) out.push(q);
  }
  breakAnswerRuns(out);
  return out;
}

function shuffleUnits(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Prevent 3+ consecutive same correct answer. Only ever swaps two STANDALONE
// questions: swapping a clustered one would undo the grouping above.
function breakAnswerRuns(arr) {
  const free = i => arr[i] && !clusterId(arr[i]);
  for (let i = 2; i < arr.length; i++) {
    if (arr[i].correct === arr[i-1].correct && arr[i].correct === arr[i-2].correct) {
      if (!free(i)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        if (free(j) && arr[j].correct !== arr[i-1].correct) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          break;
        }
      }
    }
  }
}

// ── access gate ───────────────────────────────────────────────────────────────
function setupAccessGate() {
  const attempt = () => {
    const val = document.getElementById("access-code-input").value.trim().toUpperCase();
    if (val === ACCESS_CODE) {
      document.getElementById("access-gate").style.display = "none";
      document.getElementById("mode-gate").style.display = "flex";
      setupModeGate();
    } else {
      const err = document.getElementById("access-error");
      err.textContent = "Incorrect access code. Please try again.";
      document.getElementById("access-code-input").value = "";
      document.getElementById("access-code-input").focus();
    }
  };
  document.getElementById("access-btn").addEventListener("click", attempt);
  document.getElementById("access-code-input").addEventListener("keydown",
    e => { if (e.key === "Enter") attempt(); });
}

// ── division gate ─────────────────────────────────────────────────────────────
function formatTimerLabel(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function setupDivisionGate() {
  const list = document.getElementById("division-list");
  list.innerHTML = "";
  const divisions = window.DIVISIONS || [];
  divisions.forEach(div => {
    const btn = document.createElement("div");
    btn.className = "division-btn" + (div.available ? "" : " unavailable");
    const meta = div.available
      ? `${div.real_item_count}-question timed exam &middot; ${formatTimerLabel(div.timer_seconds)} &middot; drawn from a ${div.pool_size}-question pool`
      : "Coming soon";
    btn.innerHTML = `
      <div>
        <div class="division-btn-label">${escapeHTML(div.label)}</div>
        <div class="division-btn-meta">${meta}</div>
      </div>
      ${div.available ? '<span class="division-btn-arrow">&rarr;</span>' : '<span class="division-badge-soon">Soon</span>'}
    `;
    if (div.available) {
      btn.addEventListener("click", () => selectDivision(div));
    }
    list.appendChild(btn);
  });
}

// ── mode gate ─────────────────────────────────────────────────────────────────
function setupModeGate() {
  document.getElementById("mode-real-btn").onclick = () => {
    document.getElementById("mode-gate").style.display = "none";
    document.getElementById("division-gate").style.display = "flex";
    setupDivisionGate();
  };
  document.getElementById("mode-drill-btn").onclick = () => {
    document.getElementById("mode-gate").style.display = "none";
    document.getElementById("drill-gate").style.display = "flex";
    setupDrillGate();
  };
  const backToMode = () => {
    document.getElementById("division-gate").style.display = "none";
    document.getElementById("drill-gate").style.display = "none";
    document.getElementById("mode-gate").style.display = "flex";
  };
  const divBack = document.getElementById("division-back-link");
  if (divBack) divBack.onclick = backToMode;
  const drillBack = document.getElementById("drill-back-link");
  if (drillBack) drillBack.onclick = backToMode;
}

// ── drill gate ────────────────────────────────────────────────────────────────
// Progress is a plain array of completed division keys in localStorage,
// independent of any single division's exam STORAGE_KEY, so it survives the
// full-page reload the existing Restart button already does.
function getDrillProgress() {
  try { return JSON.parse(localStorage.getItem("are_drill_progress_v1") || "[]"); }
  catch (e) { return []; }
}
function markDrillComplete(key) {
  const p = getDrillProgress();
  if (!p.includes(key)) {
    p.push(key);
    try { localStorage.setItem("are_drill_progress_v1", JSON.stringify(p)); } catch (e) {}
  }
}

function setupDrillGate() {
  const list = document.getElementById("drill-list");
  list.innerHTML = "";
  const divisions = (window.DIVISIONS || []).filter(d => d.available);
  const progress = getDrillProgress();
  let unlockedNextFound = false;
  divisions.forEach(div => {
    const done = progress.includes(div.key);
    const isNextUp = !done && !unlockedNextFound;
    const clickable = done || isNextUp;
    if (isNextUp) unlockedNextFound = true;

    const poolSize = (window.EXAM_QUESTIONS || []).filter(q => div.domains.includes(q.domain)).length;
    let meta;
    if (done) meta = `Completed &middot; ${poolSize} questions &middot; tap to retake`;
    else if (isNextUp) meta = `${poolSize}-question full pool &middot; ${formatTimerLabel(DRILL_TIMER_SECONDS)}`;
    else meta = "Locked, finish the previous division first";

    const btn = document.createElement("div");
    btn.className = "division-btn" + (clickable ? "" : " unavailable");
    btn.innerHTML = `
      <div>
        <div class="division-btn-label">${done ? "&check; " : ""}${escapeHTML(div.label)}</div>
        <div class="division-btn-meta">${meta}</div>
      </div>
      ${clickable ? '<span class="division-btn-arrow">&rarr;</span>' : '<span class="division-badge-soon">Locked</span>'}
    `;
    if (clickable) btn.addEventListener("click", () => selectDivision(div, true));
    list.appendChild(btn);
  });
}

function selectDivision(div, drill) {
  DRILL_MODE = !!drill;
  CURRENT_DIVISION = div;
  const allQ = (window.EXAM_QUESTIONS || []).filter(q => div.domains.includes(q.domain));

  if (DRILL_MODE) {
    EXAM_SECONDS = DRILL_TIMER_SECONDS;
    PASSING_PCT  = div.pass_pct;
    SIM_Q_COUNT  = allQ.length;
    STORAGE_KEY  = "are_drill_state_v1_" + div.key;
  } else {
    EXAM_SECONDS = div.timer_seconds;
    PASSING_PCT  = div.pass_pct;
    SIM_Q_COUNT  = div.real_item_count;
    STORAGE_KEY  = "are_exam_state_v1_" + div.key;
  }

  questions = pickQuestions(allQ, SIM_Q_COUNT);
  state = { phase: "gate", answers: {}, flags: {}, current: 1, timeLeft: EXAM_SECONDS, submitted: false, startTime: null };
  restoreState();

  document.getElementById("division-gate").style.display = "none";
  document.getElementById("drill-gate").style.display = "none";
  const divLabel = document.getElementById("bar-division-label");
  if (divLabel) divLabel.textContent = div.label + (DRILL_MODE ? " (Full Pool Drill)" : "");
  startExam();
}

// ── exam start ────────────────────────────────────────────────────────────────
function startExam() {
  if (state.submitted) {
    localStorage.removeItem(STORAGE_KEY);
    state = { phase: "gate", answers: {}, flags: {}, current: 1, timeLeft: EXAM_SECONDS, submitted: false, startTime: null };
  }
  document.getElementById("app").style.display = "flex";
  if (!state.startTime) state.startTime = Date.now();
  renderQuestion();
  startTimer();
  buildGrid();
  document.getElementById("submit-btn").addEventListener("click", confirmSubmit);
  document.getElementById("flag-btn").addEventListener("click",   toggleFlag);
  document.getElementById("prev-btn").addEventListener("click",   () => navigate(-1));
  document.getElementById("next-btn").addEventListener("click",   () => navigate(1));
  document.getElementById("map-btn").addEventListener("click",    openMapModal);
  document.getElementById("map-close").addEventListener("click",  closeMapModal);
  document.getElementById("map-backdrop").addEventListener("click", closeMapModal);
  document.addEventListener("keydown", keyHandler);
}

// ── timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (state.submitted) return;
    state.timeLeft = Math.max(0, EXAM_SECONDS - Math.floor((Date.now() - state.startTime) / 1000));
    updateTimerDisplay();
    if (state.timeLeft === 0) submitExam();
    saveState();
  }, 1000);
}

function updateTimerDisplay() {
  const h = Math.floor(state.timeLeft / 3600);
  const m = Math.floor((state.timeLeft % 3600) / 60);
  const s = state.timeLeft % 60;
  document.getElementById("timer-display").textContent =
    h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
           : `${m}:${String(s).padStart(2,"0")}`;
}

// ── render ─────────────────────────────────────────────────────────────────────
// Any renderer that injects content as HTML must escape it first. This helper
// was missing from the scaffold entirely, so every cluster/passage renderer
// copied in from a finished project threw ReferenceError on its first item.
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// A cluster's shared text is shown above EVERY question in that cluster, so a
// candidate never has to page backwards to reread it. It scrolls inside its own
// box: unbounded, a 450 word passage pushes the stem and options below the fold.
function renderCluster(q) {
  const wrap = document.getElementById("q-cluster-wrap");
  if (!wrap) return;
  const text = q.cluster_text || q.case_text || q.passage_text || "";
  if (!text) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
  const body = String(text).split("\n").filter(l => l.trim())
    .map(l => `<p>${escapeHTML(l.trim())}</p>`).join("");
  wrap.innerHTML = `<div class="cluster-label">${CLUSTER_LABEL} `
                 + `${escapeHTML(clusterId(q) || "")}</div>`
                 + `<div class="cluster-body">${body}</div>`;
  wrap.style.display = "block";
}

function renderQuestion() {
  const q = questions[state.current - 1];
  if (!q) return;
  renderCluster(q);
  document.getElementById("q-counter").textContent = `Question ${state.current} of ${questions.length}`;
  document.getElementById("q-domain").textContent  = domainLabel(q.domain);
  document.getElementById("question-text").textContent = q.question;
  const imgWrap = document.getElementById("q-image-wrap");
  if (q.image && qType(q) === "hotspot") {
    renderHotspotImage(imgWrap, q, state.answers[state.current]);
    imgWrap.style.display = "block";
  } else if (q.image) {
    imgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    imgWrap.style.display = "block";
  } else {
    imgWrap.innerHTML = "";
    imgWrap.style.display = "none";
  }
  const fi = document.getElementById("q-flag-indicator");
  fi.style.display = state.flags[state.current] ? "inline-block" : "none";

  document.getElementById("explanation-box").style.display = "none";

  const ol = document.getElementById("options-list");
  ol.innerHTML = "";
  const chosen = state.answers[state.current];
  if (qType(q) === "hotspot") {
    // The image itself carries the answer choices (each labeled point is a
    // click target), so there is nothing to render in the text options list.
  } else if (qType(q) === "sata") {
    const note = document.createElement("div");
    note.className = "sata-instruction";
    note.textContent = "Check all that apply";
    ol.appendChild(note);
    const chosenArr = Array.isArray(chosen) ? chosen : [];
    SATA_LETTERS.forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option" + (chosenArr.includes(letter) ? " selected" : "");
      div.innerHTML = `<span class="opt-letter">${chosenArr.includes(letter) ? "☑" : "☐"}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => toggleSataAnswer(state.current, letter));
      ol.appendChild(div);
    });
  } else {
    ["A", "B", "C", "D", "E"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option" + (chosen === letter ? " selected" : "");
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => selectAnswer(state.current, letter));
      ol.appendChild(div);
    });
  }

  // Scroll question panel to top on navigation
  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  updateProgress();
  updateGrid();
}

function selectAnswer(qNum, letter) {
  if (state.submitted) return;
  state.answers[qNum] = letter;
  renderQuestion();
  saveState();
}

function toggleSataAnswer(qNum, letter) {
  if (state.submitted) return;
  const cur = Array.isArray(state.answers[qNum]) ? state.answers[qNum].slice() : [];
  const i = cur.indexOf(letter);
  if (i === -1) cur.push(letter); else cur.splice(i, 1);
  // An empty array is truthy in JS, so leaving [] behind would make the
  // question grid and the submit-blocking check both wrongly see it as
  // answered. Delete the key entirely once nothing is checked.
  if (cur.length === 0) delete state.answers[qNum];
  else state.answers[qNum] = cur;
  renderQuestion();
  saveState();
}

function renderHotspotImage(wrap, q, chosen, reviewMode) {
  const box = document.createElement("div");
  box.className = "hotspot-imgbox";
  const img = document.createElement("img");
  img.className = "q-image";
  img.src = q.image;
  img.alt = q.question || "";
  box.appendChild(img);

  Object.entries(q.zones || {}).forEach(([letter, z]) => {
    const zone = document.createElement("div");
    zone.className = "hotspot-zone";
    zone.style.left = z.left + "%";
    zone.style.top = z.top + "%";
    zone.style.width = z.width + "%";
    zone.style.height = z.height + "%";
    if (reviewMode) {
      if (letter === q.correct) zone.classList.add("hotspot-correct");
      else if (letter === chosen) zone.classList.add("hotspot-incorrect");
    } else {
      if (letter === chosen) zone.classList.add("hotspot-selected");
      zone.addEventListener("click", () => selectAnswer(state.current, letter));
    }
    box.appendChild(zone);
  });

  wrap.innerHTML = "";
  wrap.appendChild(box);
  if (!reviewMode) {
    const hint = document.createElement("p");
    hint.className = "hotspot-hint";
    hint.textContent = "Click or tap directly on the labeled point that answers the question.";
    wrap.appendChild(hint);
  }
}

function navigate(dir) {
  const next = state.current + dir;
  if (next >= 1 && next <= questions.length) {
    state.current = next;
    renderQuestion();
  }
}

function toggleFlag() {
  state.flags[state.current] = !state.flags[state.current];
  renderQuestion();
  saveState();
}

function updateProgress() {
  const pct = Object.keys(state.answers).length / questions.length * 100;
  document.getElementById("progress-bar").style.width = pct + "%";
}

// ── question map modal ────────────────────────────────────────────────────────
function openMapModal() {
  updateGrid();
  document.getElementById("map-modal").style.display = "flex";
}

function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
}

// ── grid ──────────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById("q-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.createElement("button");
    btn.className = "grid-btn";
    btn.id = `gb-${i}`;
    btn.textContent = i;
    btn.addEventListener("click", () => {
      state.current = i;
      closeMapModal();
      renderQuestion();
    });
    grid.appendChild(btn);
  }
}

function updateGrid() {
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.getElementById(`gb-${i}`);
    if (!btn) continue;
    btn.className = "grid-btn" +
      (state.answers[i]  ? " answered" : "") +
      (state.flags[i]    ? " flagged"  : "") +
      (state.current===i ? " active"   : "");
  }
}

// ── submit ────────────────────────────────────────────────────────────────────
function confirmSubmit() {
  const unanswered = questions.length - Object.keys(state.answers).length;
  if (unanswered > 0) {
    alert(`You must answer all ${questions.length} questions before submitting.\n\n${unanswered} question${unanswered > 1 ? "s" : ""} still unanswered.\n\nTap "Question Map" to find unanswered questions.`);
    return;
  }
  if (confirm("Submit your exam now?")) submitExam();
}

function submitExam() {
  clearInterval(timerInterval);
  state.submitted = true;
  saveState();
  showResults();
}

// ── results ───────────────────────────────────────────────────────────────────
function showResults() {
  document.getElementById("app").style.display = "none";
  document.getElementById("results-screen").style.display = "flex";

  let correct = 0;
  const domainStats = {};
  questions.forEach((q, idx) => {
    const num = idx + 1;
    const userAns = state.answers[num];
    const isRight = qType(q) === "sata"
      ? sataIsCorrect(userAns, q.correct)
      : userAns === q.correct;
    if (isRight) correct++;
    const dom = q.domain || "Other";
    if (!domainStats[dom]) domainStats[dom] = { correct: 0, total: 0 };
    domainStats[dom].total++;
    if (isRight) domainStats[dom].correct++;
  });

  const pct  = Math.round(correct / questions.length * 100);
  const passed = pct >= PASSING_PCT;
  document.getElementById("res-status").textContent = passed ? "PASS" : "FAIL";
  document.getElementById("res-status").style.color = passed ? "#059669" : "#DC2626";
  document.getElementById("res-score").textContent  = `${correct} / ${questions.length} (${pct}%)`;

  const domDiv = document.getElementById("res-domains");
  domDiv.innerHTML = "";
  Object.entries(domainStats).forEach(([dom, s]) => {
    const dp = Math.round(s.correct / s.total * 100);
    domDiv.innerHTML += `<div class="res-domain-row">
      <span class="res-domain-name">${domainLabel(dom)}</span>
      <div class="res-domain-bar-wrap"><div class="res-domain-bar" style="width:${dp}%;background:#1B3A6B"></div></div>
      <span class="res-domain-pct">${dp}%</span>
    </div>`;
  });

  document.getElementById("res-review-btn").addEventListener("click", () => {
    state.submitted = true;
    document.getElementById("results-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    renderReview();
  });
  document.getElementById("res-restart-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  const contBtn = document.getElementById("res-continue-btn");
  if (DRILL_MODE && CURRENT_DIVISION) {
    markDrillComplete(CURRENT_DIVISION.key);
    contBtn.style.display = "block";
    contBtn.onclick = () => {
      document.getElementById("results-screen").style.display = "none";
      document.getElementById("drill-gate").style.display = "flex";
      setupDrillGate();
    };
  } else if (contBtn) {
    contBtn.style.display = "none";
  }
}

function renderReview() {
  const ol = document.getElementById("options-list");
  const q  = questions[state.current - 1];
  if (!q) return;
  document.getElementById("q-counter").textContent = `Review, Question ${state.current} of ${questions.length}`;
  document.getElementById("question-text").textContent = q.question;
  const revImgWrap = document.getElementById("q-image-wrap");
  const userAns = state.answers[state.current];
  if (q.image && qType(q) === "hotspot") {
    renderHotspotImage(revImgWrap, q, userAns, true);
    revImgWrap.style.display = "block";
  } else if (q.image) {
    revImgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    revImgWrap.style.display = "block";
  } else {
    revImgWrap.innerHTML = "";
    revImgWrap.style.display = "none";
  }
  ol.innerHTML = "";
  if (qType(q) === "hotspot") {
    // The image overlay above already shows correct/incorrect, nothing to
    // render in the text options list.
  } else if (qType(q) === "sata") {
    const correctSet = Array.isArray(q.correct) ? q.correct : [];
    const userSet = Array.isArray(userAns) ? userAns : [];
    const note = document.createElement("div");
    note.className = "sata-instruction";
    note.textContent = "Check all that apply";
    ol.appendChild(note);
    SATA_LETTERS.forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      const wasSelected = userSet.includes(letter);
      const isCorrectLetter = correctSet.includes(letter);
      let cls = "option";
      if (isCorrectLetter)                     cls += " correct";
      else if (wasSelected && !isCorrectLetter) cls += " incorrect";
      div.className = cls;
      div.innerHTML = `<span class="opt-letter">${wasSelected ? "☑" : "☐"}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  } else {
    ["A", "B", "C", "D", "E"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      let cls = "option";
      if (letter === q.correct)      cls += " correct";
      else if (letter === userAns)   cls += " incorrect";
      div.className = cls;
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  }

  const box  = document.getElementById("explanation-box");
  const expl = document.getElementById("explanation-text");
  if (q.explanation) {
    expl.textContent = q.explanation;
    box.style.display = "block";
  } else {
    box.style.display = "none";
  }

  document.getElementById("prev-btn").onclick = () => { navigate(-1); renderReview(); };
  document.getElementById("next-btn").onclick = () => { navigate(1);  renderReview(); };
}

// ── persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}
function restoreState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const s = JSON.parse(saved); Object.assign(state, s); }
  } catch(e) {}
}

// ── keyboard ──────────────────────────────────────────────────────────────────
function keyHandler(e) {
  const letter = e.key.toUpperCase();
  const q = questions[state.current - 1];
  if (!e.ctrlKey && !e.metaKey && q?.options?.[letter]) {
    if (qType(q) === "sata" && SATA_LETTERS.includes(letter)) toggleSataAnswer(state.current, letter);
    else if (qType(q) !== "sata" && ["A", "B", "C", "D", "E"].includes(letter)) selectAnswer(state.current, letter);
  }
  if (e.key === "ArrowRight" && state.current < questions.length) navigate(1);
  if (e.key === "ArrowLeft"  && state.current > 1)                navigate(-1);
  if (e.key === "Escape") closeMapModal();
}
