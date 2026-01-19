/* Stroop Treadmill Test
   - Mobile-friendly, touch-first.
   - Records RT (ms) + accuracy across N trials.
   - Exports a downloadable CSV.
*/

(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  const pad2 = (n) => String(n).padStart(2, '0');

  function nowISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function median(values) {
    if (!values.length) return NaN;
    const a = [...values].sort((x,y) => x-y);
    const mid = Math.floor(a.length/2);
    return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
  }

  function mean(values) {
    if (!values.length) return NaN;
    return values.reduce((s,v) => s+v, 0) / values.length;
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [];
    lines.push(headers.map(esc).join(','));
    for (const r of rows) {
      lines.push(headers.map(h => esc(r[h])).join(','));
    }
    return lines.join('\n');
  }

  function downloadText(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function safeFilename(s) {
    return (s || 'stroop')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .slice(0, 40);
  }

  // Simple beep (optional). Works on most mobile browsers after user interaction.
  function makeBeep() {

  // Speech recognition (optional; tap remains available as fallback).
  function getSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    return rec;
  }

  function normalizeSpeech(s) {
    return (s || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ');
  }

  function mapSpeechToColor(transcript) {
    const t = normalizeSpeech(transcript);
    // Allow common variants / mis-hearings
    const map = [
      ['red', 'RED'],
      ['read', 'RED'],
      ['blue', 'BLUE'],
      ['blew', 'BLUE'],
      ['green', 'GREEN'],
      ['grain', 'GREEN'],
      ['yellow', 'YELLOW'],
      ['yello', 'YELLOW']
    ];
    for (const [k, v] of map) {
      if (t === k) return v;
    }
    // Also handle phrases like "the answer is blue"
    for (const [k, v] of map) {
      if (t.includes(' ' + k) || t.startsWith(k + ' ') || t.endsWith(' ' + k)) return v;
    }
    return null;
  }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.06;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.08);
    };
  }

  // ---------- App state ----------
  const COLORS = [
    { name: 'RED', css: '#ff4d4d' },
    { name: 'BLUE', css: '#4da3ff' },
    { name: 'GREEN', css: '#52d69b' },
    { name: 'YELLOW', css: '#ffd84d' }
  ];

  const state = {
    participant: { id: '', condition: 'walk', speed: '', notes: '' },
    settings: { nTrials: 10, inconRate: 0.7, beep: true, practice: false, voice: false },
    phase: 'setup', // setup | practice | test | done
    trials: [],
    results: [],
    idx: 0,
    t0: 0,
    beepFn: null,
    rec: null,
    recActive: false,
    answered: false
  };

  // ---------- UI refs ----------
  const screenSetup = $('screenSetup');
  const screenTest  = $('screenTest');
  const screenDone  = $('screenDone');

  const btnStart = $('btnStart');
  const btnAbort = $('btnAbort');
  const btnDownload = $('btnDownload');
  const btnRestart = $('btnRestart');
  const btnFullscreen = $('btnFullscreen');

  const stimulusWord = $('stimulusWord');
  const stimulusBlock = $('stimulusBlock');
  const choiceA = $('choiceA');
  const choiceB = $('choiceB');
  const trialLabel = $('trialLabel');
  const progressBar = $('progressBar');

  const mTrials = $('mTrials');
  const mAcc = $('mAcc');
  const mMean = $('mMean');
  const mMedian = $('mMedian');
  const previewTable = $('previewTable');

  // Inputs
  const pid = $('pid');
  const condition = $('condition');
  const speed = $('speed');
  const notes = $('notes');
  const audioToggle = $('audioToggle');
  const practiceToggle = $('practiceToggle');
  const voiceToggle = $('voiceToggle');
  const nTrials = $('nTrials');
  const inconRate = $('inconRate');

  // ---------- Trial generation ----------
  function pickTwoDifferentColorNames() {
    const a = COLORS[Math.floor(Math.random() * COLORS.length)].name;
    let b = COLORS[Math.floor(Math.random() * COLORS.length)].name;
    while (b === a) b = COLORS[Math.floor(Math.random() * COLORS.length)].name;
    return [a, b];
  }

  function getColorCssByName(name) {
    const c = COLORS.find(x => x.name === name);
    return c ? c.css : '#ffffff';
  }

  function generateTrials(n, incongruentRate) {
    // Create a mix with target incongruent proportion
    const trials = [];
    for (let i = 0; i < n; i++) {
      const isIncon = Math.random() < incongruentRate;
      let word, ink;
      if (isIncon) {
        [word, ink] = pickTwoDifferentColorNames();
      } else {
        word = COLORS[Math.floor(Math.random() * COLORS.length)].name;
        ink = word;
      }

      // choices are: word label and ink label (in random order)
      const opts = shuffle([word, ink]);
      trials.push({
        trial_index: i + 1,
        word,
        ink,
        congruency: (word === ink) ? 'congruent' : 'incongruent',
        choice_left: opts[0],
        choice_right: opts[1],
        correct_answer: ink
      });
    }
    return trials;
  }

  // ---------- Flow ----------
  function show(screen) {
    screenSetup.classList.add('hidden');
    screenTest.classList.add('hidden');
    screenDone.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  function stopRecognition() {
    if (state.rec && state.recActive) {
      try { state.rec.stop(); } catch (e) {}
    }
    state.recActive = false;
  }

  function startRecognitionForTrial() {
    if (!state.settings.voice || !state.rec) return;

    // Stop any prior session
    stopRecognition();

    const rec = state.rec;
    state.recActive = true;

    // Handlers are assigned each time to capture current trial context.
    rec.onresult = (event) => {
      if (state.answered) return;
      const res = event.results && event.results[0] && event.results[0][0];
      const transcript = res ? res.transcript : '';
      const mapped = mapSpeechToColor(transcript);
      if (mapped) {
        // Prevent double-answer; lock immediately
        lockChoices(true);
        state.answered = true;
        stopRecognition();
        recordAnswer(mapped);
      }
      // If not mapped, we do nothing; tap remains available.
    };

    rec.onerror = () => {
      // On error, just stop and continue with taps.
      stopRecognition();
    };

    rec.onend = () => {
      state.recActive = false;
      // If user hasn't answered yet, taps remain; no auto-restart to avoid loops on iOS.
    };

    try {
      rec.start();
    } catch (e) {
      // Some browsers throw if start called too quickly; ignore
      stopRecognition();
    }
  }

  function lockChoices(lock) {
    choiceA.disabled = lock;
    choiceB.disabled = lock;
  }

  function setStimulus(trial) {
    stimulusWord.textContent = trial.word;
    stimulusWord.style.color = getColorCssByName(trial.ink);

    // Big block remains neutral for contrast
    // Choices
    choiceA.textContent = trial.choice_left;
    choiceB.textContent = trial.choice_right;

    choiceA.dataset.value = trial.choice_left;
    choiceB.dataset.value = trial.choice_right;
  }

  function updateProgress() {
    const total = state.trials.length;
    const current = Math.min(state.idx + 1, total);
    trialLabel.textContent = `Trial ${current} / ${total}`;
    const pct = (state.idx / total) * 100;
    progressBar.style.width = `${pct}%`;
  }

  function startPhase(phase) {
    state.phase = phase;
    state.idx = 0;
    state.results = [];
  }

  function startTest() {
    // Pull inputs
    state.participant.id = pid.value.trim();
    state.participant.condition = condition.value;
    state.participant.speed = speed.value.trim();
    state.participant.notes = notes.value.trim();
    state.settings.beep = !!audioToggle.checked;
    state.settings.voice = voiceToggle ? !!voiceToggle.checked : false;
    state.settings.practice = !!practiceToggle.checked;
    state.settings.nTrials = parseInt(nTrials.value, 10);
    state.settings.inconRate = parseFloat(inconRate.value);

    // Prepare beep after user gesture
    state.beepFn = null;
    if (state.settings.beep) {
      try { state.beepFn = makeBeep(); } catch (e) { state.beepFn = null; }
    }

    // Practice then test
    if (state.settings.practice) {
      startPhase('practice');
      state.trials = generateTrials(2, state.settings.inconRate);
    } else {
      startPhase('test');
      state.trials = generateTrials(state.settings.nTrials, state.settings.inconRate);
    }

    show(screenTest);
    presentTrial();
  }

  function presentTrial() {
    const trial = state.trials[state.idx];
    if (!trial) {
      // End of phase
      if (state.phase === 'practice') {
        // Switch to actual test
        startPhase('test');
        state.trials = generateTrials(state.settings.nTrials, state.settings.inconRate);
        presentTrial();
        return;
      }
      finish();
      return;
    }

    state.answered = false;
    updateProgress();
    lockChoices(true);

    // Small jittered delay to reduce anticipation (but keep it minimal for treadmill use)
    const delay = 250 + Math.floor(Math.random() * 250);

    // Clear then show
    stimulusWord.textContent = '—';
    stimulusWord.style.color = 'rgba(234,241,255,.65)';
    choiceA.textContent = '';
    choiceB.textContent = '';
    choiceA.dataset.value = '';
    choiceB.dataset.value = '';

    window.setTimeout(() => {
      setStimulus(trial);
      lockChoices(false);
      state.t0 = performance.now();
      startRecognitionForTrial();

      if (state.beepFn) {
        try { state.beepFn(); } catch (e) {}
      }
    }, delay);
  }

  function recordAnswer(chosen) {
    // Safety: ensure voice listener stops once answered
    stopRecognition();
    const trial = state.trials[state.idx];
    const t1 = performance.now();
    const rt_ms = Math.round(t1 - state.t0);

    const correct = chosen === trial.correct_answer;

    // Do not save practice trials
    if (state.phase === 'test') {
      state.results.push({
        timestamp_local: nowISO(),
        participant_id: state.participant.id,
        condition: state.participant.condition,
        treadmill_speed: state.participant.speed,
        notes: state.participant.notes,
        trial: trial.trial_index,
        word: trial.word,
        ink_colour: trial.ink,
        congruency: trial.congruency,
        choice_left: trial.choice_left,
        choice_right: trial.choice_right,
        correct_answer: trial.correct_answer,
        response: chosen,
        correct: correct ? 1 : 0,
        rt_ms
      });
    }

    state.idx += 1;
    presentTrial();
  }

  function finish() {
    stopRecognition();
    progressBar.style.width = '100%';
    show(screenDone);

    const rts = state.results.map(r => r.rt_ms).filter(v => Number.isFinite(v));
    const acc = state.results.length
      ? (state.results.reduce((s,r) => s + (r.correct ? 1 : 0), 0) / state.results.length)
      : 0;

    mTrials.textContent = String(state.results.length);
    mAcc.textContent = state.results.length ? `${Math.round(acc * 100)}%` : '—';
    mMean.textContent = rts.length ? `${Math.round(mean(rts))} ms` : '—';
    mMedian.textContent = rts.length ? `${Math.round(median(rts))} ms` : '—';

    // Preview table
    renderPreview(state.results.slice(0, 6));
  }

  function renderPreview(rows) {
    if (!rows.length) {
      previewTable.innerHTML = '<tr><td>No data.</td></tr>';
      return;
    }
    const headers = Object.keys(rows[0]);
    const thead = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    const tbody = rows.map(r => '<tr>' + headers.map(h => `<td>${String(r[h])}</td>`).join('') + '</tr>').join('');
    previewTable.innerHTML = thead + tbody;
  }

  // ---------- Events ----------
  btnStart.addEventListener('click', startTest);

  btnAbort.addEventListener('click', () => {
    // go back to setup without saving
    stopRecognition();
    stopRecognition();
    state.phase = 'setup';
    state.trials = [];
    state.results = [];
    show(screenSetup);
  });

  function onChoice(e) {
    const v = e.currentTarget.dataset.value;
    if (!v) return;
    if (state.answered) return;
    state.answered = true;
    // prevent double taps / stop voice if running
    lockChoices(true);
    stopRecognition();
    recordAnswer(v);
  }
  choiceA.addEventListener('click', onChoice);
  choiceB.addEventListener('click', onChoice);

  btnRestart.addEventListener('click', () => {
    stopRecognition();
    state.phase = 'setup';
    state.trials = [];
    state.results = [];
    show(screenSetup);
  });

  btnDownload.addEventListener('click', () => {
    const csv = toCSV(state.results);
    const stamp = new Date();
    const fname = [
      'stroop',
      safeFilename(state.participant.id || 'participant'),
      safeFilename(state.participant.condition || 'condition'),
      stamp.getFullYear() + pad2(stamp.getMonth()+1) + pad2(stamp.getDate()) + '_' +
        pad2(stamp.getHours()) + pad2(stamp.getMinutes())
    ].join('_') + '.csv';

    downloadText(fname, csv, 'text/csv;charset=utf-8');
  });

  btnFullscreen.addEventListener('click', async () => {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      // ignore; not supported in some iOS contexts
    }
  });

  // Prevent accidental scroll during test
  document.addEventListener('touchmove', (e) => {
    if (!screenTest.classList.contains('hidden')) {
      e.preventDefault();
    }
  }, { passive: false });

})();
