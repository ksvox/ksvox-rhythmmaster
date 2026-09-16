import { useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  useEffect(() => {
    // ==============================
    // 以下、本番の「リズムAIマスター」プログラムのロジックを
    // ほぼそのまま移植（要素IDのみ新デザインに合わせて変更）。
    // ==============================

    const STAFF_WIDTH = 260;
    const NOTATION_SCALE = 1.8;
    const STAFF_SEP = 20;

    let audioCtx;
    let synthControl;
    let timingCallbacks = null;
    let isPracticing = false;
    let isExamplePlaying = false;
    let expectedEvents = [];
    let restEvents = [];
    let tapTimings = [];
    let metronomeTimer = null;
    let preCountTimer = null;
    let rawAbcData = '';

    function getAudioCtx() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }

    function playSound(freq, type, duration, vol) {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    }

    const countInSound = () => playSound(1000, 'square', 0.1, 0.4);
    const metronomeSound = () => playSound(800, 'square', 0.05, 0.4);
    const tapSound = () => {
      const ctx = getAudioCtx();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, t);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
    };

    function buildAbc(rawAbc, bpm, isMuted) {
      let lines = rawAbc
        .split('\n')
        .filter((line) => !line.startsWith('Q:') && !line.startsWith('%%MIDI') && !line.startsWith('T:'));

      let mIndex = lines.findIndex((line) => line.startsWith('M:'));
      if (mIndex !== -1) lines[mIndex] = 'M:none';

      let kIndex = lines.findIndex((line) => line.startsWith('K:'));
      if (kIndex !== -1) {
        lines[kIndex] = 'K:C clef=none stafflines=1';
      } else {
        lines.push('K:C clef=none stafflines=1');
        kIndex = lines.length - 1;
      }

      lines = lines.map((line) => line.replace(/clef=treble/g, 'clef=none'));

      let header = lines.slice(0, kIndex + 1);
      let body = lines.slice(kIndex + 1);

      // 表示より再生速度の正確さを優先し、Q:行を復活させる(元の実績ある方式に戻す)
      header.push('Q: 1/4=' + bpm);
      header.push('%%MIDI channel 10');
      header.push('%%MIDI transpose -21');
      if (isMuted) {
        header.push('%%MIDI control 7 0');
      } else {
        header.push('%%MIDI control 7 127');
      }

      return header.concat(body).join('\n');
    }

    function computeExpectedEvents(rawAbc, bpm, startTimestamp) {
      const lines = rawAbc
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const noteLines = lines.filter((l) => !/^(X:|%%|T:|M:|L:|Q:|K:|V:)/.test(l));
      const msPerUnit = 60000 / bpm / 2;

      const events = [];
      const rests = [];
      let elapsedUnits = 0;
      let pendingTie = false;

      noteLines.forEach((rawLine) => {
        let line = rawLine.replace(/\|\]\s*$/, '').replace(/\|\s*$/, '');
        line = line.replace(/\s+/g, '');
        const tokenRegex = /([Cz])(\/2|\d+)?(-)?/g;
        let match;
        while ((match = tokenRegex.exec(line)) !== null) {
          const isRest = match[1] === 'z';
          const mod = match[2];
          const hasTie = !!match[3];
          let duration = 1;
          if (mod === '/2') duration = 0.5;
          else if (mod) duration = parseInt(mod, 10);

          if (!isRest && !pendingTie) {
            const noteDurationMs = duration * msPerUnit;
            events.push({
              time: startTimestamp + elapsedUnits * msPerUnit,
              perfectTolerance: noteDurationMs * 0.1,
              goodTolerance: noteDurationMs * 0.2,
            });
          }
          if (isRest) {
            const restDurationMs = duration * msPerUnit;
            rests.push({
              start: startTimestamp + elapsedUnits * msPerUnit,
              end: startTimestamp + (elapsedUnits + duration) * msPerUnit,
              tolerance: Math.max(restDurationMs * 0.3, 60),
            });
          }
          elapsedUnits += duration;
          pendingTie = !isRest && hasTie;
        }
      });

      return { events, rests };
    }

    const cursorControl = {
      onEvent: function (ev) {
        if (ev === null || ev === undefined) {
          cursorControl.onFinished();
          return;
        }

        const svg = document.querySelector('#staffContainer svg');
        if (svg) {
          svg.querySelectorAll('.abcjs-note').forEach((n) => {
            n.setAttribute('fill', '#000000');
            n.style.fill = '#000000';
            n.querySelectorAll('*').forEach((c) => {
              c.setAttribute('fill', '#000000');
              c.style.fill = '#000000';
            });
          });
        }

        if (ev && ev.elements) {
          ev.elements.forEach((set) => {
            set.forEach((item) => {
              item.setAttribute('fill', '#ef4444');
              item.style.fill = '#ef4444';
              item.querySelectorAll('*').forEach((c) => {
                c.setAttribute('fill', '#ef4444');
                c.style.fill = '#ef4444';
              });
            });
          });
        }
      },
      onFinished: function () {
        const svg = document.querySelector('#staffContainer svg');
        if (svg) {
          svg.querySelectorAll('.abcjs-note').forEach((n) => {
            n.setAttribute('fill', '#000000');
            n.style.fill = '#000000';
            n.querySelectorAll('*').forEach((c) => {
              c.setAttribute('fill', '#000000');
              c.style.fill = '#000000';
            });
          });
        }
        clearInterval(metronomeTimer);

        if (isPracticing) {
          isPracticing = false;
          setAiMessage('AIコーチが判定中...');
          setTimeout(evaluateTaps, 500);
        }
        if (isExamplePlaying) {
          isExamplePlaying = false;
          resetListenButton();
        }
      },
    };

    function setAiMessage(text) {
      const el = document.getElementById('aiMessage');
      if (el) el.textContent = text;
    }

    function resetListenButton() {
      const textEl = document.getElementById('listenBtnText');
      const btnEl = document.getElementById('listenBtn');
      if (textEl) textEl.textContent = '正解を聞く (模範演奏)';
      if (btnEl) btnEl.classList.replace('bg-rose-500', 'bg-amber-500');
    }

    function evaluateTaps() {
      let perfect = 0;
      let good = 0;
      let miss = 0;
      let availableTaps = [...tapTimings];

      expectedEvents.forEach((evt) => {
        let closestTapIndex = -1;
        let minDiff = Infinity;

        availableTaps.forEach((tapTime, index) => {
          let diff = Math.abs(evt.time - tapTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestTapIndex = index;
          }
        });

        if (minDiff <= evt.perfectTolerance) {
          perfect++;
        } else if (minDiff <= evt.goodTolerance) {
          good++;
        } else {
          miss++;
        }
        if (closestTapIndex > -1) availableTaps.splice(closestTapIndex, 1);
      });

      miss += availableTaps.length;

      const totalNotes = expectedEvents.length;
      const totalTaps = tapTimings.length;

      let tappedDuringRest = false;
      availableTaps.forEach((tapTime) => {
        restEvents.forEach((rest) => {
          if (tapTime >= rest.start - rest.tolerance && tapTime <= rest.end + rest.tolerance) {
            tappedDuringRest = true;
          }
        });
      });

      const candidates = [];
      if (totalNotes > 0) {
        if (totalTaps >= totalNotes * 1.1) candidates.push('落ち着いて！メトロノームをよく聴いて👂');
        if (totalTaps <= totalNotes * 0.9) candidates.push('まずは繰り返し声に出して練習しよう👄');
        if (tappedDuringRest) candidates.push('休符もリズムの一部だよ🎵');
        if (perfect === 0) candidates.push('タップのタイミングの精度を上げよう👆');
        if (perfect + good >= totalNotes * 0.8) candidates.push('いいね！あとは繰り返し練習あるのみ👍');
        if (miss === 0) candidates.push('すごい！その調子でリズムマスターを目指せ🔥');
        if (miss >= totalNotes * 0.5) candidates.push('テンポやレベルを下げて猛特訓だ👺');
      }
      const comment = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : '判定完了！もう一度挑戦してみよう。';

      const scorePerfectEl = document.getElementById('scorePerfect');
      const scoreGoodEl = document.getElementById('scoreGood');
      const scoreMissEl = document.getElementById('scoreMiss');
      if (scorePerfectEl) scorePerfectEl.textContent = String(perfect);
      if (scoreGoodEl) scoreGoodEl.textContent = String(good);
      if (scoreMissEl) scoreMissEl.textContent = String(miss);

      setAiMessage(comment);
    }

    function validateAbcBody(rawAbc) {
      const lines = rawAbc
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const noteLines = lines.filter((l) => !/^(X:|%%|T:|M:|L:|Q:|K:|V:)/.test(l));

      if (noteLines.length !== 4) {
        console.warn('検証NG: 小節の行数が4行ではありません →', noteLines.length, '行');
        return false;
      }

      for (let i = 0; i < noteLines.length; i++) {
        let line = noteLines[i];
        line = line.replace(/\|\]\s*$/, '').replace(/\|\s*$/, '');
        if (line.includes('|')) {
          console.warn('検証NG: 小節の途中に不正な "|" があります →', noteLines[i]);
          return false;
        }
        const cleaned = line.replace(/-/g, '').replace(/\s+/g, '');
        const tokenRegex = /[Cz](\/2|\d+)?/g;
        let match;
        let total = 0;
        let consumedLength = 0;
        while ((match = tokenRegex.exec(cleaned)) !== null) {
          consumedLength += match[0].length;
          const mod = match[1];
          if (!mod) total += 1;
          else if (mod === '/2') total += 0.5;
          else total += parseInt(mod, 10);
        }
        if (consumedLength !== cleaned.length) {
          console.warn('検証NG: 未知の記号が含まれています →', noteLines[i]);
          return false;
        }
        if (total !== 8) {
          console.warn(
            '検証NG: ' + (i + 1) + '小節目の拍数が正しくありません(実際:' + total + 'ユニット/正解:8ユニット) →',
            noteLines[i]
          );
          return false;
        }
      }
      return true;
    }

    async function requestRhythm(bpm, level) {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bpm, level }),
      });
      if (!response.ok) {
        let detail = '';
        try {
          const errBody = await response.json();
          detail = errBody?.debugDetail || errBody?.error || '';
        } catch (e) {}
        throw new Error(detail ? `server-error: ${detail}` : 'server-error');
      }
      const data = await response.json();
      if (!(data.data && data.data.outputs && data.data.outputs.rhythm_data)) {
        throw new Error('no-data');
      }
      return data.data.outputs.rhythm_data.replace(/```abc/g, '').replace(/```/g, '').trim();
    }

    function stopAllPlayback() {
      if (synthControl) synthControl.pause();
      if (timingCallbacks) timingCallbacks.stop();
      if (preCountTimer) {
        clearInterval(preCountTimer);
        preCountTimer = null;
      }
      if (metronomeTimer) {
        clearInterval(metronomeTimer);
        metronomeTimer = null;
      }
    }

    function resetScoreBoard() {
      const scorePerfectEl = document.getElementById('scorePerfect');
      const scoreGoodEl = document.getElementById('scoreGood');
      const scoreMissEl = document.getElementById('scoreMiss');
      if (scorePerfectEl) scorePerfectEl.textContent = '0';
      if (scoreGoodEl) scoreGoodEl.textContent = '0';
      if (scoreMissEl) scoreMissEl.textContent = '0';
    }

    // --- イベント登録 ---
    if (!window.ABCJS) {
      console.warn('ABCJSがまだ読み込まれていません');
    }
    synthControl = new window.ABCJS.synth.SynthController();
    synthControl.load('#audio-controls', cursorControl, {
      displayRestart: false,
      displayPlay: false,
      displayProgress: false,
    });

    const tapBtn = document.getElementById('tapBtn');
    let lastTapTime = 0;
    function handleTap() {
      const now = Date.now();
      if (now - lastTapTime < 100) return;
      lastTapTime = now;

      tapSound();
      tapBtn?.classList.add('pressed');
      setTimeout(() => tapBtn?.classList.remove('pressed'), 100);
      if (isPracticing) tapTimings.push(now);
    }
    tapBtn?.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        handleTap();
      },
      { passive: false }
    );
    tapBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handleTap();
    });

    function onSpaceKey(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        handleTap();
      }
    }
    window.addEventListener('keydown', onSpaceKey);

    const generateBtn = document.getElementById('generateBtn');
    async function onGenerateClick() {
      if (isPracticing || isExamplePlaying) return;

      stopAllPlayback();
      resetScoreBoard();
      const staff = document.getElementById('staffContainer');
      staff.innerHTML = '<p class="text-slate-400 text-sm">生成中...</p>';

      const bpm = document.getElementById('tempoSelect').value;
      const level = document.getElementById('levelSelect').value;
      document.getElementById('tempoBadge').textContent = `BPM: ${bpm}`;
      const maxAttempts = 3;
      let lastErrorDetail = '';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            staff.innerHTML = `<p class="text-slate-400 text-sm">AIが作り直しています…（${attempt}/${maxAttempts}回目）</p>`;
          }

          const candidate = await requestRhythm(bpm, level);

          if (!validateAbcBody(candidate)) {
            continue;
          }

          rawAbcData = candidate;
          const displayAbc = buildAbc(rawAbcData, bpm, false);
          staff.innerHTML = '';
          window.ABCJS.renderAbc('staffContainer', displayAbc, {
            staffwidth: STAFF_WIDTH,
            scale: NOTATION_SCALE,
            paddingtop: 10,
            paddingbottom: 40,
            format: { staffsep: STAFF_SEP },
          });
          setAiMessage(`レベル${level} (BPM ${bpm}) の新しいリズムを生成したよ！「正解を聞く」で確認して「練習開始」に挑戦しよう！`);
          return;
        } catch (e) {
          lastErrorDetail = e && e.message ? String(e.message) : '';
          // サーバー混雑など一時的なエラーの可能性があるので、すぐ諦めず
          // 少し待ってから残りの試行回数まではリトライする
          if (attempt < maxAttempts) {
            const waitSec = attempt + 1; // 1回目失敗後は2秒、2回目失敗後は3秒...と段階的に延ばす
            staff.innerHTML = `<p class="text-slate-400 text-sm">サーバーが混み合っているようです。${waitSec}秒待って再試行します…（${attempt}/${maxAttempts}回目）</p>`;
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
            continue;
          }
        }
      }

      staff.innerHTML = `<p class="text-rose-400 text-sm">リズムの生成に手間取っています。お手数ですが、もう一度「③ リズムを生成」を押してください。</p>${
        lastErrorDetail ? `<p class="text-rose-300 text-[10px] mt-2 break-words">[詳細] ${lastErrorDetail}</p>` : ''
      }`;
      return;
    }
    generateBtn?.addEventListener('click', onGenerateClick);

    const startBtn = document.getElementById('startPracticeBtn');
    async function onStartClick() {
      if (!rawAbcData) {
        alert('先に「③ リズムを生成」を押してください。');
        return;
      }
      if (isPracticing || isExamplePlaying) return;

      getAudioCtx();
      isPracticing = true;
      tapTimings = [];
      resetScoreBoard();

      const bpm = parseInt(document.getElementById('tempoSelect').value, 10);
      const practiceAbc = buildAbc(rawAbcData, bpm, true);
      const visualObj = window.ABCJS.renderAbc('staffContainer', practiceAbc, {
        staffwidth: STAFF_WIDTH,
        scale: NOTATION_SCALE,
        paddingtop: 10,
        paddingbottom: 40,
        format: { staffsep: STAFF_SEP },
      });

      stopAllPlayback();
      timingCallbacks = new window.ABCJS.TimingCallbacks(visualObj[0], {
        qpm: bpm,
        eventCallback: cursorControl.onEvent,
        callback: cursorControl.onFinished,
      });

      const intervalMs = (60 / bpm) * 1000;
      let count = 0;
      setAiMessage('カウント後にスタート！リズムに合わせて「ここをタップ！」を押してね！');

      preCountTimer = setInterval(() => {
        count++;
        if (count <= 4) {
          countInSound();
          setAiMessage(`カウント: ${4 - count + 1}...`);
        } else {
          clearInterval(preCountTimer);
          preCountTimer = null;
          setAiMessage('★ START! リズム通りにタップしよう！ ★');

          const playbackStartTime = Date.now();
          const computed = computeExpectedEvents(rawAbcData, bpm, playbackStartTime);
          expectedEvents = computed.events;
          restEvents = computed.rests;

          timingCallbacks.start();
          metronomeSound();

          let beatCount = 1;
          metronomeTimer = setInterval(() => {
            metronomeSound();
            beatCount++;
            if (beatCount >= 16) {
              clearInterval(metronomeTimer);
              metronomeTimer = null;
            }
          }, intervalMs);
        }
      }, intervalMs);
    }
    startBtn?.addEventListener('click', onStartClick);

    const listenBtn = document.getElementById('listenBtn');
    async function startListenPlayback() {
      if (!rawAbcData) {
        alert('先に「③ リズムを生成」を押してください。');
        return;
      }
      if (isPracticing || isExamplePlaying) return;

      getAudioCtx();
      isExamplePlaying = true;

      const textEl = document.getElementById('listenBtnText');
      if (textEl) textEl.textContent = '再生停止';
      listenBtn?.classList.replace('bg-amber-500', 'bg-rose-500');

      const bpm = document.getElementById('tempoSelect').value;
      const exampleAbc = buildAbc(rawAbcData, bpm, false);

      const visualObj = window.ABCJS.renderAbc('staffContainer', exampleAbc, {
        staffwidth: STAFF_WIDTH,
        scale: NOTATION_SCALE,
        paddingtop: 10,
        paddingbottom: 40,
        format: { staffsep: STAFF_SEP },
      });
      stopAllPlayback();
      await synthControl.setTune(visualObj[0], true, { audioContext: getAudioCtx() });

      const intervalMs = (60 / parseInt(bpm, 10)) * 1000;
      let count = 0;
      setAiMessage('準備...');

      preCountTimer = setInterval(() => {
        count++;
        if (count <= 4) {
          countInSound();
          setAiMessage(`カウント: ${4 - count + 1}...`);
        } else {
          clearInterval(preCountTimer);
          preCountTimer = null;
          setAiMessage('お手本を再生中...');

          synthControl.play();
          metronomeSound();

          let beatCount = 1;
          metronomeTimer = setInterval(() => {
            metronomeSound();
            beatCount++;
            if (beatCount >= 16) {
              clearInterval(metronomeTimer);
              metronomeTimer = null;
            }
          }, intervalMs);
        }
      }, intervalMs);
    }
    listenBtn?.addEventListener('click', () => {
      if (isExamplePlaying) {
        stopAllPlayback();
        isExamplePlaying = false;
        resetListenButton();
        setAiMessage('停止しました。');
      } else {
        startListenPlayback();
      }
    });

    return () => {
      window.removeEventListener('keydown', onSpaceKey);
      stopAllPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Head>
        <title>リズムAIマスター | K&apos;s VOX</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <div className="w-full max-w-2xl mx-auto px-4 pt-6 space-y-6 pb-12">
        {/* 1. タイトルエリア */}
        <header className="flex items-center justify-between bg-black border-2 border-slate-700 p-4 rounded-xl shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
              <img src="/logo.png" alt="リズムAIマスター Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="mb-1">
                <span className="pixel-font bg-indigo-950 text-cyan-300 text-[9px] px-2 py-0.5 rounded border border-cyan-500/50 tracking-wider">
                  K&apos;s VOX APPLICATION
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-cyan-300">
                リズムAIマスター
              </h1>
              <p className="text-xs text-slate-400">Rhythm AI Training Arcade</p>
            </div>
          </div>
          <span className="pixel-font bg-pink-600 text-white text-xs px-2.5 py-1 rounded-md border border-pink-300 shadow-sm animate-pulse">
            Ver2.0
          </span>
        </header>

        {/* 2. 説明文エリア */}
        <div className="retro-box p-4 rounded-xl text-sm leading-relaxed text-slate-200">
          <div className="flex items-center space-x-2 text-yellow-400 mb-2 font-bold border-b border-slate-700 pb-1">
            <span>【ご注意とお願い】</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm text-slate-300">
            <li>ご利用の環境によっては正しく動作しないことがありますがご了承ください。</li>
            <li>「リズムの生成」時にAIを使用します。一度リズムを生成すれば、同じリズムを繰り返し練習できます。テンポだけを変えることも可能です。連続でのリズム生成はお控えください⚠</li>
            <li>429/503エラーが出た場合は、しばらく時間を空けてから再度お試しください。その他エラーが出たときは、画面の再読込やキャッシュクリアをお試しください。</li>
          </ul>
        </div>

        {/* 3. 入力フィールド */}
        <div className="retro-box-gold p-5 rounded-xl space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-yellow-400 font-bold mb-1">① レベルを選択</label>
              <select
                id="levelSelect"
                defaultValue="4"
                className="w-full bg-slate-900 border-2 border-yellow-500/60 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-yellow-400 text-sm font-semibold"
              >
                <option value="1">レベル1 (基本4分音符)</option>
                <option value="2">レベル2 (休符ミックス)</option>
                <option value="3">レベル3 (2分音符ミックス)</option>
                <option value="4">レベル4 (16分音符導入)</option>
                <option value="5">レベル5 (シンコペーションあり)</option>
                <option value="6">レベル6 (裏打ちリズム)</option>
                <option value="7">レベル7 (16分音符多め)</option>
                <option value="8">レベル8 (全パターン総合)</option>
                <option value="9">レベル9 (シンコペーション強化)</option>
                <option value="10">レベル10 (最上級・高密度)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-cyan-400 font-bold mb-1">② テンポ (BPM)</label>
              <select
                id="tempoSelect"
                defaultValue="80"
                className="w-full bg-slate-900 border-2 border-cyan-500/60 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-400 text-sm font-semibold"
              >
                <option value="70">BPM 70</option>
                <option value="80">BPM 80</option>
                <option value="90">BPM 90</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              id="generateBtn"
              type="button"
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-lg border border-blue-400 shadow-md active:scale-95 transition flex items-center justify-center space-x-2"
            >
              <span>③ リズムを生成</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                ></path>
              </svg>
            </button>

            <button
              id="startPracticeBtn"
              type="button"
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg border border-emerald-400 shadow-md active:scale-95 transition flex items-center justify-center space-x-2"
            >
              <span>④ 練習開始</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                ></path>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        {/* 4. 楽譜表示エリア */}
        <div className="bg-slate-900 border-4 border-slate-700 rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex items-center justify-end text-xs text-slate-300 px-1">
            <span id="tempoBadge" className="text-cyan-400 font-mono font-bold">
              BPM: 80
            </span>
          </div>

          <div
            className="bg-white rounded-lg p-4 pb-10 text-slate-900 border-2 border-slate-300 shadow-inner min-h-[560px] flex justify-center items-start overflow-x-auto overflow-y-visible"
            id="staffContainer"
          >
            <p className="text-slate-400 text-sm text-center">③を押して生成してください</p>
          </div>

          {/* ABCJS用の非表示オーディオコントロール領域 */}
          <div id="audio-controls" style={{ display: 'none' }}></div>
        </div>

        {/* 5. タップボタン */}
        <div className="text-center py-1">
          <button
            id="tapBtn"
            type="button"
            className="arcade-btn w-full py-8 rounded-2xl text-2xl sm:text-3xl font-black text-white tracking-widest uppercase select-none cursor-pointer flex flex-col items-center justify-center gap-1"
          >
            <span>ここをタップ！</span>
            <span className="text-xs text-red-200 font-normal tracking-normal">[ Spaceキー / 画面タップ ]</span>
          </button>
        </div>

        {/* 6. 正解を聞くボタン */}
        <div>
          <button
            id="listenBtn"
            type="button"
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg border border-amber-300 shadow active:scale-95 transition flex items-center justify-center space-x-2"
          >
            <svg id="listenIcon" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              ></path>
            </svg>
            <span id="listenBtnText">正解を聞く (模範演奏)</span>
          </button>
        </div>

        {/* 7. 判定結果 */}
        <div className="retro-cmd-window p-4 rounded-lg text-white space-y-3">
          <div className="text-xs text-emerald-400 font-bold tracking-widest flex items-center justify-between border-b border-slate-800 pb-1">
            <span>▼ 判定結果</span>
            <span className="blink text-yellow-400">STATUS: READY</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center bg-slate-950 p-2 rounded border border-slate-800 text-sm font-mono">
            <div className="text-emerald-400">
              <div className="text-[10px] text-slate-400">PERFECT</div>
              <span id="scorePerfect" className="text-lg font-bold">
                0
              </span>
            </div>
            <div className="text-yellow-400">
              <div className="text-[10px] text-slate-400">GOOD</div>
              <span id="scoreGood" className="text-lg font-bold">
                0
              </span>
            </div>
            <div className="text-rose-500">
              <div className="text-[10px] text-slate-400">MISS</div>
              <span id="scoreMiss" className="text-lg font-bold">
                0
              </span>
            </div>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 text-xs sm:text-sm text-yellow-200 min-h-[60px] flex items-center leading-relaxed font-mono">
            <span className="mr-2 text-emerald-400 font-bold">▶</span>
            <span id="aiMessage">レベルとテンポを選んで「リズムを生成」を押してね！AIが練習メニューを準備するよ。</span>
          </div>
        </div>

        {/* 8. YouTube再生リスト */}
        <div className="retro-box p-3 rounded-xl space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-red-400">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
            </svg>
            <span>K&apos;s VOX YouTubeチャンネル～オリジナル英語曲Short MV～</span>
          </div>
          <div className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-black aspect-[21/9]">
            <iframe
              className="absolute top-0 left-0 w-full h-full"
              src="https://www.youtube.com/embed/videoseries?list=PLtNoF8CCU5z24deNi6ppU3iAeoiyMJod3"
              title="K's VOX YouTubeチャンネル～オリジナル英語曲Short MV～"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            ></iframe>
          </div>
        </div>

        {/* 9. フッター */}
        <footer className="text-center pt-4 text-xs text-slate-400">
          提供：
          <a
            href="https://www.ksvox.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline hover:text-cyan-300 font-bold"
          >
            ボーカル道場K&apos;s VOX
          </a>
        </footer>
      </div>
    </>
  );
}
