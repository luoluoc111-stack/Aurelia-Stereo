// ===== CHANNELS (aligned exactly to the printed scale numbers) =====
const stations = [
    { freq: 86, id: 'station-play', label: 'PLAY' },
    { freq: 88, id: 'station-story', label: 'STORY' },
    { freq: 90, id: 'station-index', label: 'INDEX' },
    { freq: 92, id: 'station-credits', label: 'CREDITS' },
    { freq: 94, id: 'station-notes', label: 'NOTES' },
    { freq: 96, id: 'station-visuals', label: 'VISUALS' },
    { freq: 98, id: 'station-archive', label: 'ARCHIVE' },
    { freq: 100, id: 'station-end', label: 'END' }
];

const SECRET_FREQ = 4.625;
const DISPLAY_MIN = 86;
const DISPLAY_MAX = 100;
const SNAP_RANGE = 0.5;
const PAD = 26;
const MINOR_TICKS_PER_GAP = 3;

const needle = document.getElementById('needle');
const freqInput = document.getElementById('freq-input');
const readoutSection = document.getElementById('readout-section');
const noSignal = document.getElementById('no-signal');
const numbersWord = document.getElementById('numbers-word');
const scaleWindow = document.getElementById('scale-window');
const scaleLabelsEl = document.getElementById('scale-labels');
const scaleTicksEl = document.getElementById('scale-ticks');

let currentFreq = 86;
let volume = 0.6;
let lockedStationId = null;
let secretActive = false;
let secretTickTimer = null;

function fracToPx(frac) {
    const width = scaleWindow.clientWidth;
    const usable = width - PAD * 2;
    return PAD + frac * usable;
}

function buildScale() {
    scaleLabelsEl.innerHTML = '';
    scaleTicksEl.innerHTML = '';

    stations.forEach((s, i) => {
        const frac = i / (stations.length - 1);
        const left = fracToPx(frac);

        const label = document.createElement('div');
        label.className = 'scale-label-item';
        label.style.left = `${left}px`;
        label.innerHTML = `<span class="label-tag">${s.label}</span><span class="label-freq">${s.freq}</span>`;
        scaleLabelsEl.appendChild(label);

        const major = document.createElement('div');
        major.className = 'tick-major';
        major.style.left = `${left}px`;
        scaleTicksEl.appendChild(major);

        if (i < stations.length - 1) {
            for (let m = 1; m <= MINOR_TICKS_PER_GAP; m++) {
                const minorFrac = (i + m / (MINOR_TICKS_PER_GAP + 1)) / (stations.length - 1);
                const minor = document.createElement('div');
                minor.className = 'tick-minor';
                minor.style.left = `${fracToPx(minorFrac)}px`;
                scaleTicksEl.appendChild(minor);
            }
        }
    });
}

function updateNeedle(freq) {
    if (secretActive) {
        needle.classList.add('hidden');
        return;
    }
    needle.classList.remove('hidden');
    const frac = (freq - DISPLAY_MIN) / (DISPLAY_MAX - DISPLAY_MIN);
    needle.style.left = `${fracToPx(frac)}px`;
}

let audioCtx = null;
let mediaSourceNode = null;
let analyserNode = null;

// ===== SHARED: detect numbered sequential files (1.jpg, 2.jpg, 3.png, ...) =====
// A static host can't list a folder's contents on its own, but since these
// files follow strict numbering, we can ask "does 1 exist? does 2 exist?"
// and stop at the first gap. This keeps the visual lightbox data-free.
async function detectSequentialFiles(basePath, extensions, maxTry = 30) {
    const found = [];
    for (let i = 1; i <= maxTry; i++) {
        let matched = null;
        for (const ext of extensions) {
            const url = `${basePath}/${i}.${ext}`;
            try {
                const res = await fetch(url, { method: 'HEAD' });
                if (res.ok) { matched = url; break; }
            } catch (e) {
                // network error — treat as not found
            }
        }
        if (!matched) break; // first gap in numbering means the set ends here
        found.push(matched);
    }
    return found;
}

// ===== SINGLE-RELEASE AUDIO =====
// This microsite has one continuous master track.  Tuning changes the printed
// chapter only; it never changes the music underneath it.
const stationMusic = new Audio();
const MAIN_TRACK_URL = 'assets/audio/home/BAP-web.mp3';
stationMusic.preload = 'auto';
stationMusic.src = new URL(MAIN_TRACK_URL, document.baseURI).href;
stationMusic.load();
stationMusic.loop = true;
stationMusic.volume = 0;
let playbackRequested = false;
let playbackError = null;
let musicIsPlaying = false;
let deviceSfxGain = null;
const localFilePlayback = location.protocol === 'file:';
function reportPlaybackError(error) {
    playbackError = error;
    musicIsPlaying = false;
    console.error('Master playback failed', { error, source: stationMusic.currentSrc || MAIN_TRACK_URL, readyState: stationMusic.readyState, mediaError: stationMusic.error, contextState: audioCtx?.state });
    syncTransportButton();
}
function syncTransportButton() {
    const button = document.getElementById('play-toggle');
    if (!button) return;
    const paused = stationMusic.paused;
    button.classList.toggle('is-playing', !paused);
    button.setAttribute('aria-pressed', String(!paused));
    button.querySelector('.transport-icon').textContent = paused ? '▶' : 'Ⅱ';
    button.querySelector('.transport-label').textContent = paused ? 'PLAY' : 'PAUSE';
    const archiveButton = document.getElementById('archive-listen');
    if (archiveButton) {
        archiveButton.classList.toggle('is-playing', !paused);
        archiveButton.querySelector('i').textContent = paused ? '▶' : 'Ⅱ';
        archiveButton.querySelector('span').textContent = paused ? 'LISTEN' : 'PAUSE';
    }
    const state = document.getElementById('spectrum-state');
    if (state) {
        state.textContent = localFilePlayback ? 'FFT OFF · USE LOCALHOST' : playbackError ? 'ERROR · RETRY PLAY' : paused ? 'PAUSED' : !musicIsPlaying ? 'LOADING' : audioCtx?.state !== 'running' ? 'AUDIO SUSPENDED' : 'LIVE';
        state.title = localFilePlayback ? 'Local file playback: serve this folder over localhost for the live analyser and downloads.' : playbackError?.message || '';
    }
}
function playStationMusic() {
    playbackError = null;
    stationMusic.volume = volume;
    if (!stationMusic.src || stationMusic.error) {
        stationMusic.src = new URL(MAIN_TRACK_URL, document.baseURI).href;
        stationMusic.load();
    }
    if (!playbackRequested) {
        syncTransportButton();
        return;
    }
    initAudio();
    stationMusic.play().then(syncTransportButton).catch(reportPlaybackError);
}
function stopStationMusic() {
    playbackRequested = false;
    stationMusic.pause();
    syncTransportButton();
}

function toggleMainPlayback() {
    initAudio();
    if (stationMusic.paused || playbackError) {
        playbackRequested = true;
        playStationMusic();
    } else {
        stopStationMusic();
    }
}

function initAudio() {
    try {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(reportPlaybackError);
        return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    deviceSfxGain = audioCtx.createGain();
    deviceSfxGain.gain.value = 0.35;
    deviceSfxGain.connect(audioCtx.destination);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.78;
    // Opaque file origins can silence MediaElementSource. Leave native playback
    // connected on file://; HTTP(S) uses the unchanged real FFT signal path.
    if (!localFilePlayback) {
        mediaSourceNode = audioCtx.createMediaElementSource(stationMusic);
        mediaSourceNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(reportPlaybackError);
    } catch (error) { reportPlaybackError(error); }
}

let spectrumLevels = [];
let spectrumPeaks = [];
let spectrumPeakHold = [];
function drawSpectrum() {
    const canvas = document.getElementById('spectrum-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    const barCount = canvas.clientWidth < 520 ? 42 : 64;
    const gap = 2 * dpr;
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    const frequencyData = new Uint8Array(analyserNode ? analyserNode.frequencyBinCount : 256);
    if (analyserNode && !stationMusic.paused) analyserNode.getByteFrequencyData(frequencyData);
    if (spectrumLevels.length !== barCount) {
        spectrumLevels = new Array(barCount).fill(0);
        spectrumPeaks = new Array(barCount).fill(0);
        spectrumPeakHold = new Array(barCount).fill(0);
    }
    const binWidthHz = analyserNode && audioCtx ? audioCtx.sampleRate / analyserNode.fftSize : 43;
    const minBin = Math.max(1, Math.floor(40 / binWidthHz));
    const maxBin = Math.max(minBin + 1, Math.min(frequencyData.length - 1, Math.floor(16000 / binWidthHz)));
    for (let i = 0; i < barCount; i++) {
        const start = Math.max(minBin, Math.floor(minBin * Math.pow(maxBin / minBin, i / barCount)));
        const end = Math.max(start + 1, Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / barCount)));
        let total = 0;
        let strongest = 0;
        for (let bin = start; bin < Math.min(end, frequencyData.length); bin++) {
            total += frequencyData[bin];
            strongest = Math.max(strongest, frequencyData[bin]);
        }
        const average = total / Math.max(1, end - start);
        const target = stationMusic.paused ? 0 : Math.pow((average * 0.58 + strongest * 0.42) / 255, 0.78);
        const response = target > spectrumLevels[i] ? 0.44 : 0.1;
        spectrumLevels[i] += (target - spectrumLevels[i]) * response;
        if (spectrumLevels[i] >= spectrumPeaks[i]) {
            spectrumPeaks[i] = spectrumLevels[i];
            spectrumPeakHold[i] = 30;
        } else if (spectrumPeakHold[i] > 0) {
            spectrumPeakHold[i]--;
        } else {
            spectrumPeaks[i] = Math.max(spectrumLevels[i], spectrumPeaks[i] - 0.009);
        }
        const x = i * (barWidth + gap);
        const barHeight = Math.max(1.5 * dpr, spectrumLevels[i] * height * 0.9);
        const peakY = height - spectrumPeaks[i] * height * 0.9;
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#36434a';
        ctx.fillRect(x, 0, barWidth, height);
        ctx.globalAlpha = 0.96;
        ctx.fillStyle = spectrumLevels[i] > 0.82 ? '#d8d1c0' : '#718790';
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        if (spectrumPeaks[i] > 0.04) {
            ctx.fillStyle = '#b9a579';
            ctx.fillRect(x, peakY, barWidth, Math.max(1, 1.5 * dpr));
        }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(drawSpectrum);
}

function noteFreq(semitonesFromA4) {
    return 440 * Math.pow(2, semitonesFromA4 / 12);
}

function playChime(stationIndex) {
    if (!audioCtx) return;
    const scale = [0, 2, 4, 7, 9];
    const root = -12 + (stationIndex % 5) * 2;
    const notes = [0, 2, 4].map(i => noteFreq(root + scale[(i + stationIndex) % scale.length]));

    notes.forEach((freq, i) => {
        const t = audioCtx.currentTime + i * 0.14;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain).connect(deviceSfxGain);
        osc.start(t);
        osc.stop(t + 0.4);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });
}

function playBeep() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(deviceSfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

const secretWords = [
    'AWAIT', 'SILENCE', 'THRESHOLD', 'ECHO', 'ORCHID', 'VESSEL', 'HOLLOW',
'SEVENTEEN', 'GARDEN', 'AWAKE', 'STILL', 'MARROW', 'LATTICE', 'CIPHER',
'DORMANT', 'RELAY', 'WITNESS', 'UNSPOKEN', 'DRIFT', 'SIGNAL', 'BURIED',
'NOCTURNE', 'FRACTURE', 'HARBOR', 'WITHHELD', 'SEVERANCE', 'QUIET',
'ANTENNA', 'FORWARD', 'CONCEAL', 'PATIENCE', 'ASHEN', 'REMNANT', 'FROST',
'SENTINEL', 'ABSENT', 'CORRIDOR', 'PERIMETER', 'SUSPEND', 'KEEPER'
];
let wordHistory = [];

function pickWord() {
    const historyLimit = Math.min(6, secretWords.length - 1);
    const options = secretWords.filter(w => !wordHistory.includes(w));
    const word = options[Math.floor(Math.random() * options.length)];
    wordHistory.push(word);
    if (wordHistory.length > historyLimit) wordHistory.shift();
    return word;
}

function enterSecretStation() {
    secretActive = true;
    wordHistory = [];
    setActivePanel('station-numbers');
    noSignal.classList.remove('visible');
    readoutSection.textContent = '???';
    freqInput.value = SECRET_FREQ;
    needle.classList.add('hidden');

    const tick = () => {
        numbersWord.textContent = pickWord();
        playBeep();
        secretTickTimer = setTimeout(tick, 1400 + Math.random() * 2600);
    };
    tick();
}

function exitSecretStation() {
    secretActive = false;
    clearTimeout(secretTickTimer);
}

function findStationAt(freq) {
    return stations.find(s => s.freq === freq) || null;
}

let lastEnteredPanel = null;
function setActivePanel(id) {
    const enter = lastEnteredPanel !== id;
    lastEnteredPanel = id;
    document.querySelectorAll('.station').forEach(el => {
        const isActive = el.id === id;
        el.classList.toggle('active', isActive);
        if (isActive && enter && document.getElementById('intro-modal').classList.contains('hidden')) {
            revealTypewriter(el);
            revealStationLine(el);
        }
    });
}

function revealStationLine(panel) {
    const line = panel.querySelector('.station-line');
    if (!line) return;
    const fullText = line.dataset.fullText || line.textContent.trim();
    line.dataset.fullText = fullText;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { line.textContent = fullText; return; }
    const token = String(Date.now());
    line.dataset.revealToken = token;
    line.textContent = '';
    let index = 0;
    const typeNext = () => {
        if (line.dataset.revealToken !== token) return;
        if (!panel.classList.contains('active')) { line.textContent = fullText; return; }
        index++;
        line.textContent = fullText.slice(0, index);
        if (index < fullText.length) setTimeout(typeNext, 18);
    };
    typeNext();
}

function revealTypewriter(panel) {
    panel.querySelectorAll('[data-typewriter]').forEach(el => {
        const fullText = el.dataset.fullText || el.textContent.trim();
        el.dataset.fullText = fullText;
        const token = String(performance.now());
        el.dataset.revealToken = token;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fullText; return; }
        el.textContent = '';
        let index = 0;
        let lastTime = 0;
        const write = time => {
            if (el.dataset.revealToken !== token) return;
            if (!panel.classList.contains('active')) { el.textContent = fullText; return; }
            if (time - lastTime > 16) {
                index = Math.min(fullText.length, index + 2);
                el.textContent = fullText.slice(0, index);
                lastTime = time;
            }
            if (index < fullText.length) requestAnimationFrame(write);
        };
        requestAnimationFrame(write);
    });
}

function updateDisplay() {
    if (secretActive) {
        updateNeedle(currentFreq);
        return;
    }

    let nearest = stations[0];
    let minDist = Math.abs(currentFreq - nearest.freq);
    for (const s of stations) {
        const d = Math.abs(currentFreq - s.freq);
        if (d < minDist) { minDist = d; nearest = s; }
    }
    const locked = minDist <= SNAP_RANGE;
    const displayValue = locked ? nearest.freq : currentFreq;

    updateNeedle(displayValue);
    freqInput.value = locked ? nearest.freq : displayValue.toFixed(1);

    if (locked) {
        noSignal.classList.remove('visible');
        setActivePanel(nearest.id);
        readoutSection.textContent = nearest.label;
        if (lockedStationId !== nearest.id) {
            lockedStationId = nearest.id;
            playChime(stations.indexOf(nearest));
            readoutSection.classList.remove('station-feedback');
            void readoutSection.offsetWidth;
            readoutSection.classList.add('station-feedback');
            const slug = nearest.id.replace('station-', '');
            history.replaceState(null, '', `#${slug}`);
        }
    } else {
        lockedStationId = null;
        document.querySelectorAll('.station').forEach(el => el.classList.remove('active'));
        noSignal.classList.add('visible');
        readoutSection.textContent = 'SEARCHING';
    }
}

function makeKnob(el, { min, max, initial, pxForFullRange, axis = 'x', onChange, onStart }) {
    const indicator = el.querySelector('.knob-indicator');
    let value = initial;
    let dragging = false;
    let startPos = 0;
    let startValue = 0;

    function render() {
        const frac = (value - min) / (max - min);
        const deg = -130 + frac * 260;
        indicator.style.transform = `translateX(-50%) rotate(${deg}deg)`;
    }

    el.addEventListener('pointerdown', (e) => {
        if (onStart) onStart();
        dragging = true;
        startPos = axis === 'x' ? e.clientX : e.clientY;
        startValue = value;
        el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const pos = axis === 'x' ? e.clientX : e.clientY;
        const delta = axis === 'x' ? (pos - startPos) : (startPos - pos);
        const deltaValue = (delta / pxForFullRange) * (max - min);
        value = Math.max(min, Math.min(max, startValue + deltaValue));
        render();
        onChange(value);
    });

    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });

    render();
    return { setValue: (v) => { value = Math.max(min, Math.min(max, v)); render(); } };
}

const tuningKnob = makeKnob(document.getElementById('tuning-knob'), {
    min: DISPLAY_MIN, max: DISPLAY_MAX, initial: 86, pxForFullRange: 240, axis: 'x',
    onStart: initAudio,
    onChange: (v) => {
        if (secretActive) exitSecretStation();
        currentFreq = v;
        updateDisplay();
    }
});

makeKnob(document.getElementById('volume-knob'), {
    min: 0, max: 1, initial: 0.6, pxForFullRange: 140, axis: 'y',
    onStart: initAudio,
    onChange: (v) => {
        volume = v;
        stationMusic.volume = volume;
    }
});

freqInput.addEventListener('focus', () => freqInput.select());

function commitInput() {
    const parsed = parseFloat(freqInput.value);
    if (!isNaN(parsed)) {
        if (Math.abs(parsed - SECRET_FREQ) < 0.001) {
            if (!secretActive) enterSecretStation();
        } else {
            if (secretActive) exitSecretStation();
            currentFreq = Math.max(DISPLAY_MIN, Math.min(DISPLAY_MAX, parsed));
            tuningKnob.setValue(currentFreq);
            updateDisplay();
        }
    }
    freqInput.blur();
}

freqInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitInput();
});
freqInput.addEventListener('blur', commitInput);

// Unlock the audio graph once. This never changes playback intent: after a
// deliberate pause, only the transport control is allowed to resume the track.
function unlockAudioOnce() {
    initAudio();
    document.removeEventListener('pointerdown', unlockAudioOnce);
    document.removeEventListener('keydown', unlockAudioOnce);
}
document.addEventListener('pointerdown', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

document.getElementById('intro-modal-ok').addEventListener('click', () => {
    initAudio();
    playbackRequested = true;
    playStationMusic();
    initLocalConditions();
    document.getElementById('intro-modal').classList.add('hidden');
    const active = document.querySelector('.station.active');
    if (active) { revealTypewriter(active); revealStationLine(active); }
});

document.getElementById('play-toggle').addEventListener('click', toggleMainPlayback);
document.getElementById('archive-listen').addEventListener('click', toggleMainPlayback);
document.getElementById('archive-download').addEventListener('click', downloadMainTrack);
stationMusic.addEventListener('play', syncTransportButton);
stationMusic.addEventListener('pause', syncTransportButton);
stationMusic.addEventListener('playing', () => { musicIsPlaying = true; playbackError = null; syncTransportButton(); });
stationMusic.addEventListener('waiting', () => { musicIsPlaying = false; syncTransportButton(); });
stationMusic.addEventListener('error', () => reportPlaybackError(stationMusic.error || new Error('Audio could not load')));
['loadeddata', 'canplay'].forEach(name => stationMusic.addEventListener(name, () => console.debug('Master audio', name, { readyState: stationMusic.readyState, contextState: audioCtx?.state })));

async function downloadMainTrack() {
    const button = document.getElementById('archive-download');
    if (button.disabled) return;
    const status = document.getElementById('download-status');
    if (localFilePlayback) {
        status.textContent = '下载需要 localhost / preview server；当前为本地文件模式。';
        console.error('Master download unavailable on file://. Serve the project on localhost.', { source: MAIN_TRACK_URL });
        return;
    }
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'PREPARING…';
    status.textContent = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const source = new URL(MAIN_TRACK_URL, document.baseURI);
        const response = await fetch(source, { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Audio download failed: ${response.status}`);
        if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Audio URL returned HTML; check the deployed asset path.');
        const blob = await response.blob();
        if (!blob.size) throw new Error('Audio response is empty.');
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = 'release-master.mp3';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        button.textContent = 'DOWNLOAD SENT';
        status.textContent = '下载已交给浏览器 / Check browser downloads.';
    } catch (error) {
        console.error('Master download failed', { error, source: new URL(MAIN_TRACK_URL, document.baseURI).href });
        button.textContent = 'DOWNLOAD FAILED';
        status.textContent = '下载未完成，请重试 / Download failed — please retry.';
    } finally {
        clearTimeout(timeout);
        setTimeout(() => {
            button.textContent = originalLabel;
            button.disabled = false;
        }, 1800);
    }
}

const storySwitch = document.querySelector('.story-switch');
document.querySelectorAll('[data-story-panel]').forEach(panel => { panel.id = `${panel.dataset.storyPanel}-text`; });
storySwitch.addEventListener('click', () => {
    const process = storySwitch.classList.toggle('is-process');
    storySwitch.setAttribute('aria-checked', String(process));
    storySwitch.querySelector('.story-label').textContent = process ? 'PROCESS' : 'STORY';
    document.querySelectorAll('[data-story-panel]').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.storyPanel === (process ? 'process' : 'story'));
    });
});

const releaseDrawer = document.getElementById('release-drawer');
const releaseInfoToggle = document.getElementById('release-info-toggle');
function setReleaseDrawer(open) {
    releaseDrawer.classList.toggle('open', open);
    releaseDrawer.setAttribute('aria-hidden', String(!open));
    releaseInfoToggle.setAttribute('aria-expanded', String(open));
    releaseInfoToggle.querySelector('span').textContent = open ? '◂' : '▸';
}
releaseInfoToggle.addEventListener('click', () => setReleaseDrawer(!releaseDrawer.classList.contains('open')));
document.getElementById('release-info-close').addEventListener('click', () => setReleaseDrawer(false));

const visualSlides = [...document.querySelectorAll('.visual-slide')];
const visualSelectors = [...document.querySelectorAll('[data-visual-index]')];
let visualIndex = 0;
function setVisual(index) {
    visualIndex = (index + visualSlides.length) % visualSlides.length;
    visualSlides.forEach((slide, i) => slide.classList.toggle('active', i === visualIndex));
    visualSelectors.forEach((button, i) => {
        button.classList.toggle('active', i === visualIndex);
        button.setAttribute('aria-selected', String(i === visualIndex));
    });
}
document.getElementById('visual-prev').addEventListener('click', () => setVisual(visualIndex - 1));
document.getElementById('visual-next').addEventListener('click', () => setVisual(visualIndex + 1));
visualSelectors.forEach(button => button.addEventListener('click', () => setVisual(Number(button.dataset.visualIndex))));
const visualWindow = document.getElementById('visual-window');
function openCurrentVisual() {
    openGallery(visualSlides[visualIndex].dataset.visualProject);
}
visualWindow.addEventListener('click', openCurrentVisual);
visualWindow.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCurrentVisual();
    }
});

// ===== 90 / INDEX — local typewriter search =====
const typewriterKeyboard = document.getElementById('typewriter-keyboard');
const typewriterMachine = document.getElementById('typewriter-machine');
const indexQueryEl = document.getElementById('index-query');
const indexResultsEl = document.getElementById('index-results');
const indexPaper = document.getElementById('index-paper');
const keyboardRows = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M','Backspace'],
    [' ','Enter']
];
let indexQuery = '';
let indexPrintToken = 0;

keyboardRows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'key-row';
    row.forEach(key => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.key = key;
        button.className = key === ' ' ? 'type-key space-key' : key === 'Enter' ? 'type-key return-key' : key === 'Backspace' ? 'type-key backspace-key' : 'type-key';
        button.textContent = key === ' ' ? 'SPACE' : key === 'Enter' ? 'RETURN' : key === 'Backspace' ? 'BACK' : key;
        button.addEventListener('click', () => handleIndexKey(key));
        rowEl.appendChild(button);
    });
    typewriterKeyboard.appendChild(rowEl);
});

function animateTypewriterKey(key) {
    const selectorKey = key.length === 1 && key !== ' ' ? key.toUpperCase() : key;
    const button = [...typewriterKeyboard.querySelectorAll('[data-key]')].find(el => el.dataset.key === selectorKey);
    if (button) {
        button.classList.remove('pressed');
        void button.offsetWidth;
        button.classList.add('pressed');
        setTimeout(() => button.classList.remove('pressed'), 105);
    }
    typewriterMachine.classList.remove('type-clack');
    void typewriterMachine.offsetWidth;
    typewriterMachine.classList.add('type-clack');
}

function updateIndexQuery() {
    if (indexQueryEl.value !== indexQuery) indexQueryEl.value = indexQuery;
    indexResultsEl.innerHTML = '';
    indexPrintToken++;
}

function handleIndexKey(key) {
    animateTypewriterKey(key);
    playTypewriterClick(key);
    if (key === 'Backspace') {
        indexQuery = Array.from(indexQuery).slice(0, -1).join('');
        updateIndexQuery();
        return;
    }
    if (key === 'Enter') {
        executeIndexSearch();
        return;
    }
    if (Array.from(indexQuery).length >= 120) return;
    if (Array.from(key).length === 1) {
        indexQuery += key;
        updateIndexQuery();
    }
}

document.addEventListener('keydown', event => {
    if (!document.getElementById('station-index').classList.contains('active')) return;
    if (!document.getElementById('intro-modal').classList.contains('hidden') || document.getElementById('lightbox').classList.contains('visible')) return;
    if (event.target === freqInput || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.target === indexQueryEl) {
        animateTypewriterKey(event.key);
        if (event.key === 'Enter') { event.preventDefault(); playTypewriterClick('Enter'); executeIndexSearch(); }
        return;
    }
    if (event.target.closest('button,a,input,textarea,[contenteditable]') && !event.target.closest('.type-key')) return;
    let key = event.key;
    if (key === 'Backspace' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        handleIndexKey(key);
    } else if (Array.from(key).length === 1) {
        event.preventDefault();
        handleIndexKey(key.toUpperCase());
    }
});
indexQueryEl.addEventListener('input', event => {
    indexQuery = Array.from(indexQueryEl.value).slice(0, 120).join('');
    updateIndexQuery();
    if (!event.isComposing) playTypewriterClick(event.inputType === 'deleteContentBackward' ? 'Backspace' : 'key');
});
document.addEventListener('paste', event => {
    if (!document.getElementById('station-index').classList.contains('active') || event.target.closest('input,textarea,[contenteditable]')) return;
    event.preventDefault();
    indexQuery = Array.from(indexQuery + event.clipboardData.getData('text')).slice(0, 120).join('').replace(/[\r\n]/g, ' ');
    updateIndexQuery();
    playTypewriterClick('key');
});
function playTypewriterClick(key) {
    initAudio();
    if (!audioCtx || audioCtx.state !== 'running' || !deviceSfxGain) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    const isReturn = key === 'Enter';
    const duration = isReturn ? .16 : .035;
    osc.type = isReturn ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime((isReturn ? 1350 : key === 'Backspace' ? 300 : 650) + Math.random() * 60, now);
    osc.frequency.exponentialRampToValueAtTime(isReturn ? 1000 : 100, now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(isReturn ? .09 : .12, now + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain); gain.connect(deviceSfxGain);
    osc.start(now); osc.stop(now + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

function buildLocalIndex() {
    const entries = [];
    stations.filter(station => station.id !== 'station-index').forEach(station => {
        const panel = document.getElementById(station.id);
        if (!panel) return;
        const nodes = panel.querySelectorAll('h1,h3,.station-tag,.station-body,.station-eyebrow,.release-artist,.release-meta,.archive-kicker,.credits-list>div,.notes-grid article,.visual-selector button,.download-list>div,.end-links,.copyright');
        nodes.forEach(node => {
            const text = (node.dataset.fullText || node.textContent).replace(/\s+/g, ' ').trim();
            if (!text) return;
            const headingNode = node.querySelector?.('h3,dt,strong');
            const heading = headingNode ? headingNode.textContent.trim() : node.matches('h1,h3') ? text : station.label;
            entries.push({ freq: station.freq, name: station.label, heading, text });
        });
    });
    return entries;
}

function searchLocalIndex(query) {
    const normalized = query.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return buildLocalIndex().map(entry => {
        const text = entry.text.toLowerCase();
        const heading = entry.heading.toLowerCase();
        let score = text === normalized ? 160 : text.includes(normalized) ? 90 : 0;
        terms.forEach(term => {
            if (heading.includes(term)) score += 32;
            if (text.includes(term)) score += 14;
        });
        if (terms.every(term => text.includes(term))) score += 30;
        return { ...entry, score };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}

function printIndexText(text, onComplete) {
    const token = ++indexPrintToken;
    indexResultsEl.innerHTML = '<pre class="index-output"></pre>';
    const output = indexResultsEl.querySelector('.index-output');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { output.textContent = text; if (onComplete) onComplete(); return; }
    let index = 0;
    const print = () => {
        if (token !== indexPrintToken) return;
        index = Math.min(text.length, index + 2);
        output.textContent = text.slice(0, index);
        if (index < text.length) setTimeout(print, 12);
        else if (onComplete) onComplete();
    };
    print();
}

function renderIndexResults(results) {
    indexResultsEl.innerHTML = '';
    results.forEach((result, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'index-result';
        button.innerHTML = `<b>MATCH ${String(index + 1).padStart(2, '0')}</b><span>${result.freq}.0 FM / ${result.name}</span><em>${result.heading} — ${result.text.slice(0, 92)}</em>`;
        button.addEventListener('click', () => {
            currentFreq = result.freq;
            tuningKnob.setValue(currentFreq);
            updateDisplay();
        });
        indexResultsEl.appendChild(button);
    });
}

function executeIndexSearch() {
    indexPaper.classList.remove('carriage-return');
    void indexPaper.offsetWidth;
    indexPaper.classList.add('carriage-return');
    const results = searchLocalIndex(indexQuery);
    if (!indexQuery.trim()) {
        printIndexText('ENTER A TERM.\nPRESS RETURN TO SEARCH.');
    } else if (!results.length) {
        printIndexText('NO MATCH FOUND.\nTRY ANOTHER ENTRY.');
    } else {
        const transcript = results.map((result, index) => `MATCH ${String(index + 1).padStart(2, '0')}\n${result.freq}.0 FM / ${result.name}\n${result.heading} — ${result.text.slice(0, 72)}`).join('\n\n');
        printIndexText(transcript, () => renderIndexResults(results));
    }
}

let conditionsIsDay = null;
let conditionsRequested = false;
function updateLocalClock() {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    document.getElementById('local-time').textContent = `LOCAL ${time}`;
    const isDay = conditionsIsDay === null ? now.getHours() >= 7 && now.getHours() < 19 : conditionsIsDay;
    document.getElementById('day-phase').textContent = isDay ? 'DAY' : 'NIGHT';
}

function weatherKind(code) {
    if (code === 0) return 'clear';
    if (code <= 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloud';
}

function weatherLabel(code) {
    if (code === 0) return 'CLEAR';
    if (code <= 2) return 'PARTLY CLOUDY';
    if (code === 3) return 'OVERCAST';
    if (code === 45 || code === 48) return 'FOG';
    if (code >= 51 && code <= 57) return 'DRIZZLE';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'RAIN';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'SNOW';
    if (code >= 95) return 'THUNDERSTORM';
    return 'CONDITIONS';
}

function renderWeatherIcon(kind, isDay) {
    const icon = document.getElementById('weather-icon');
    const resolvedKind = kind === 'clear' && !isDay ? 'moon' : kind;
    const patterns = {
        clear: [2, 7, 10, 11, 12, 13, 14, 17, 22],
        moon: [1, 5, 10, 15, 16, 21, 22],
        cloud: [6, 7, 10, 11, 12, 13, 14, 16, 17, 18],
        fog: [5, 6, 7, 8, 11, 12, 13, 16, 17, 18],
        rain: [6, 7, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24],
        snow: [6, 7, 10, 11, 12, 13, 14, 16, 18, 21, 23],
        storm: [6, 7, 10, 11, 12, 13, 14, 17, 21, 22]
    };
    const activeCells = new Set(patterns[resolvedKind] || patterns.cloud);
    icon.className = `conditions-icon weather-${resolvedKind}`;
    icon.innerHTML = Array.from({ length: 25 }, (_, index) => {
        const weatherMotion = resolvedKind === 'rain' && [16, 18, 20, 22, 24].includes(index) ? ' drop' : '';
        const snowMotion = resolvedKind === 'snow' && [16, 18, 21, 23].includes(index) ? ' flake' : '';
        const moonLight = resolvedKind === 'moon' && index === 4 ? ' twinkle' : '';
        return `<i class="${activeCells.has(index) ? 'active' : ''}${weatherMotion}${snowMotion}${moonLight}"></i>`;
    }).join('');
}

function setWeatherUnavailable(message = 'WEATHER UNAVAILABLE') {
    conditionsIsDay = null;
    updateLocalClock();
    document.getElementById('weather-summary').textContent = message;
    document.getElementById('weather-temp').textContent = '--°';
    renderWeatherIcon('fog', new Date().getHours() >= 7 && new Date().getHours() < 19);
}

function initLocalConditions() {
    if (conditionsRequested) return;
    conditionsRequested = true;
    const retry = document.getElementById('weather-retry');
    retry.disabled = true;
    const finish = () => { conditionsRequested = false; retry.disabled = false; };
    const fail = (message, error) => {
        console.error('Local conditions:', message, error);
        setWeatherUnavailable(message);
        finish();
    };
    if (!window.isSecureContext) { fail('LOCATION NEEDS HTTPS', new Error('Geolocation requires a secure context')); return; }
    if (!navigator.geolocation) {
        fail('LOCATION UNAVAILABLE', new Error('Geolocation is unavailable'));
        return;
    }
    document.getElementById('weather-summary').textContent = 'LOCATING…';
    navigator.geolocation.getCurrentPosition(async position => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            document.getElementById('weather-summary').textContent = 'LOCATION OK / CONNECTING';
            const { latitude, longitude } = position.coords;
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&current=temperature_2m,weather_code,is_day&timezone=auto`;
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
            const data = await response.json();
            const current = data.current;
            if (!current || !Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code) || ![0,1].includes(current.is_day)) throw new Error('Invalid current-weather response');
            conditionsIsDay = current.is_day === 1;
            document.getElementById('weather-summary').textContent = weatherLabel(current.weather_code);
            document.getElementById('weather-temp').textContent = `${Math.round(current.temperature_2m)}°C`;
            renderWeatherIcon(weatherKind(current.weather_code), conditionsIsDay);
            updateLocalClock();
        } catch (error) {
            fail('LOCATION OK / WEATHER OFFLINE', error);
        } finally { clearTimeout(timeout); finish(); }
    }, error => fail(error.code === 1 ? 'PERMISSION DENIED' : error.code === 3 ? 'LOCATION TIMEOUT' : 'LOCATION UNAVAILABLE', { code: error.code, message: error.message }), { enableHighAccuracy: false, timeout: 12000, maximumAge: 900000 });
}
document.getElementById('weather-retry').addEventListener('click', initLocalConditions);
setWeatherUnavailable();
updateLocalClock();
setInterval(updateLocalClock, 30000);

window.addEventListener('resize', () => {
    buildScale();
    updateNeedle(currentFreq);
});

// ===== PROJECT IMAGE GALLERY (LIGHTBOX) =====
// Cover thumbnails default to .jpg (set directly in the HTML) but fall back
// to other extensions automatically if that guess is wrong.
document.querySelectorAll('.image-slot[data-project] img').forEach(img => {
    const slot = img.closest('.image-slot');
    const slug = slot.dataset.project;
    const extensions = ['jpg', 'jpeg', 'png'];
    let i = extensions.indexOf('jpg') + 1; // HTML already tried jpg, so start from the next one
    img.addEventListener('error', () => {
        if (i >= extensions.length) return; // out of guesses — the styled placeholder box still shows
        img.src = `assets/projects/${slug}/1.${extensions[i]}`;
        i++;
    });
});

const galleryCache = {};
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxPrev = document.getElementById('lightbox-prev');
const lightboxNext = document.getElementById('lightbox-next');
const lightboxClose = document.getElementById('lightbox-close');

let currentGallery = [];
let currentGalleryIndex = 0;

function showLightboxImage(index) {
    currentGalleryIndex = (index + currentGallery.length) % currentGallery.length;
    lightboxImage.src = currentGallery[currentGalleryIndex];
    lightboxCounter.textContent = `${currentGalleryIndex + 1} / ${currentGallery.length}`;
}

async function openGallery(slug) {
    if (!galleryCache[slug]) {
        galleryCache[slug] = await detectSequentialFiles(`assets/projects/${slug}`, ['jpg', 'jpeg', 'png']);
    }
    currentGallery = galleryCache[slug];
    if (currentGallery.length === 0) {
        console.warn(`No images found for "${slug}" — expected assets/projects/${slug}/1.jpg (or .jpeg/.png). If you're testing by double-clicking index.html rather than through a local server, that's the likely cause.`);
        return;
    }
    lightbox.classList.add('visible');
    showLightboxImage(0);
}

function closeLightbox() {
    lightbox.classList.remove('visible');
}

document.querySelectorAll('.image-slot[data-project]').forEach(slot => {
    slot.addEventListener('click', () => openGallery(slot.dataset.project));
});

lightboxPrev.addEventListener('click', () => showLightboxImage(currentGalleryIndex - 1));
lightboxNext.addEventListener('click', () => showLightboxImage(currentGalleryIndex + 1));
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('visible')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showLightboxImage(currentGalleryIndex - 1);
    if (e.key === 'ArrowRight') showLightboxImage(currentGalleryIndex + 1);
});

buildScale();

// On load, jump straight to whatever station is in the URL hash (if any)
(function initFromHash() {
    const slug = window.location.hash.replace('#', '');
    const match = stations.find(s => s.id === `station-${slug}`);
    if (match) {
        currentFreq = match.freq;
        tuningKnob.setValue(currentFreq);
    }
})();

window.addEventListener('hashchange', () => {
    const slug = window.location.hash.replace('#', '');
    const match = stations.find(s => s.id === `station-${slug}`);
    if (!match) return;
    currentFreq = match.freq;
    tuningKnob.setValue(currentFreq);
    updateDisplay();
});

// Move the existing canvas only at the mobile breakpoint. Audio/FFT nodes and
// animation state are never rebuilt when the viewport changes.
const spectrumModule = document.querySelector('.global-spectrum');
const spectrumMobileSlot = document.querySelector('.spectrum-mobile-slot');
const spectrumControlRow = document.querySelector('.control-row');
const spectrumMobileLayout = matchMedia('(max-width: 700px)');
function placeSpectrum() {
    const spectrumToggle = document.getElementById('spectrum-mobile-toggle');
    if (spectrumMobileLayout.matches) {
        spectrumMobileSlot.appendChild(spectrumModule);
        if (spectrumToggle) spectrumMobileSlot.appendChild(spectrumToggle);
    } else {
        spectrumControlRow.insertBefore(spectrumModule, document.querySelector('.readout-block'));
    }
}
spectrumMobileLayout.addEventListener('change', placeSpectrum);
placeSpectrum();

setVisual(0);
syncTransportButton();
drawSpectrum();
updateDisplay();

// Fine-pointer ornament only; native text selection and touch keep their cursor.
const cursorCapability = matchMedia('(hover: hover) and (pointer: fine)');
const cursorReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cursorRing = document.createElement('div');
cursorRing.className = 'cursor-ring';
cursorRing.setAttribute('aria-hidden', 'true');
document.body.appendChild(cursorRing);
let cursorFrame = 0;
let cursorPoint = null;
const cursorGhosts = Array.from({ length:8 }, () => {
    const dot = document.createElement('div');
    dot.className = 'cursor-ghost';
    dot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dot);
    return dot;
});
const cursorClick = document.createElement('div');
cursorClick.className = 'cursor-click';
cursorClick.setAttribute('aria-hidden', 'true');
document.body.appendChild(cursorClick);
let ghostIndex = 0;
let lastGhostTime = -Infinity;
let lastGhostPoint = null;
function clearCursorEffects() {
    cursorGhosts.forEach(dot => dot.classList.remove('tracing'));
    cursorClick.classList.remove('radiating');
    lastGhostPoint = null;
    lastGhostTime = -Infinity;
}
function canUseCursor(event) {
    return cursorCapability.matches && event.pointerType === 'mouse'
        && !event.target.closest('input,textarea,[contenteditable]');
}
function disableCursor() {
    document.documentElement.classList.remove('cursor-enabled');
    cursorRing.style.opacity = '0';
    cancelAnimationFrame(cursorFrame);
    cursorFrame = 0;
    cursorRing.classList.remove('pressed');
    clearCursorEffects();
}
document.addEventListener('pointermove', event => {
    if (!canUseCursor(event)) { disableCursor(); return; }
    document.documentElement.classList.add('cursor-enabled');
    cursorRing.style.opacity = '1';
    cursorRing.classList.toggle('over-control', !!event.target.closest('button:not(:disabled),a,.knob,[role="button"]'));
    cursorRing.classList.toggle('over-dial', !!event.target.closest('.knob'));
    cursorPoint = { x:event.clientX, y:event.clientY };
    const now = performance.now();
    if (!cursorReducedMotion.matches && now - lastGhostTime >= 24 && lastGhostPoint
        && Math.hypot(cursorPoint.x - lastGhostPoint.x, cursorPoint.y - lastGhostPoint.y) >= 3) {
        const dot = cursorGhosts[ghostIndex++ % cursorGhosts.length];
        dot.style.left = `${lastGhostPoint.x}px`;
        dot.style.top = `${lastGhostPoint.y}px`;
        dot.classList.remove('tracing');
        void dot.offsetWidth;
        dot.classList.add('tracing');
        lastGhostTime = now;
        lastGhostPoint = cursorPoint;
    }
    if (!lastGhostPoint) lastGhostPoint = cursorPoint;
    const drawCursor = () => { cursorRing.style.left = `${cursorPoint.x}px`; cursorRing.style.top = `${cursorPoint.y}px`; cursorFrame = 0; };
    if (cursorReducedMotion.matches) drawCursor();
    else if (!cursorFrame) cursorFrame = requestAnimationFrame(drawCursor);
});
document.addEventListener('pointerdown', event => {
    if (!canUseCursor(event)) { disableCursor(); return; }
    cursorRing.classList.add('pressed');
    if (!cursorReducedMotion.matches) {
        cursorClick.style.left = `${event.clientX}px`;
        cursorClick.style.top = `${event.clientY}px`;
        cursorClick.classList.remove('radiating');
        void cursorClick.offsetWidth;
        cursorClick.classList.add('radiating');
    }
});
document.addEventListener('pointerup', () => {
    cursorRing.classList.remove('pressed');
});
document.addEventListener('pointercancel', disableCursor);
document.addEventListener('pointerout', event => { if (!event.relatedTarget) disableCursor(); });
window.addEventListener('blur', disableCursor);
cursorCapability.addEventListener('change', disableCursor);
cursorReducedMotion.addEventListener('change', clearCursorEffects);


// ===== MOBILE KEYBOARD STABILITY (ported from Aurelia Keyboard Lab v3) =====
(() => {
    const mobileMq = matchMedia('(max-width: 700px)');
    const root = document.documentElement;
    const body = document.body;
    const indexInput = document.getElementById('index-query');
    const screenEl = document.querySelector('.screen');
    const spectrumToggle = document.getElementById('spectrum-mobile-toggle');

    let lockedHeight = 0;
    let lockedScrollY = 0;
    let restoreTimer = 0;
    let keyboardSeen = false;
    let autoRecovering = false;

    function viewportHeight() {
        return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    }

    function rememberNormalHeight(force = false) {
        if (!mobileMq.matches) return;
        if (!force && body.classList.contains('keyboard-lock')) return;
        lockedHeight = viewportHeight();
        root.style.setProperty('--stable-app-height', `${lockedHeight}px`);
    }

    function lockForKeyboard() {
        if (!mobileMq.matches || !indexInput || body.classList.contains('keyboard-lock')) return;

        clearTimeout(restoreTimer);
        keyboardSeen = false;
        lockedHeight = viewportHeight();
        lockedScrollY = window.scrollY || 0;
        root.style.setProperty('--stable-app-height', `${lockedHeight}px`);
        root.style.setProperty('--keyboard-locked-height', `${lockedHeight}px`);
        body.classList.add('keyboard-lock');

        // Do not scroll the INDEX station or lift the receiver. The OS keyboard
        // is allowed to cover the lower part of the unchanged receiver.
        window.scrollTo(0, lockedScrollY);
    }

    function canUnlock() {
        const vv = window.visualViewport;
        if (!vv) return true;
        return vv.height >= lockedHeight - 80;
    }

    function unlockAfterKeyboard() {
        if (!body.classList.contains('keyboard-lock')) return;
        clearTimeout(restoreTimer);

        let stableFrames = 0;
        let lastVisibleHeight = -1;

        const finishUnlock = () => {
            // Record the restored viewport first, while the old locked frame is
            // still painted. Only then release the fixed body on the next frame.
            rememberNormalHeight(true);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    body.classList.remove('keyboard-lock');
                    root.style.removeProperty('--keyboard-locked-height');
                    window.scrollTo(0, lockedScrollY);
                    keyboardSeen = false;
                });
            });
        };

        const attempt = (tries = 0) => {
            const vv = window.visualViewport;
            const visibleHeight = vv ? vv.height : viewportHeight();
            const restored = canUnlock();

            if (restored) {
                if (Math.abs(visibleHeight - lastVisibleHeight) < 2) stableFrames++;
                else stableFrames = 0;
                lastVisibleHeight = visibleHeight;

                // Require several stable samples after the keyboard animation
                // has visually finished. This avoids exposing the browser's
                // blank viewport for a frame while Android is still resizing.
                if (stableFrames >= 2) {
                    finishUnlock();
                    return;
                }
            } else {
                stableFrames = 0;
                lastVisibleHeight = visibleHeight;
            }

            if (tries >= 14) {
                finishUnlock();
                return;
            }

            restoreTimer = setTimeout(() => attempt(tries + 1), 45);
        };

        restoreTimer = setTimeout(() => attempt(0), 80);
    }

    function onViewportChange() {
        if (!mobileMq.matches) return;

        if (body.classList.contains('keyboard-lock')) {
            window.scrollTo(0, lockedScrollY);

            const vv = window.visualViewport;
            const visibleHeight = vv ? vv.height : viewportHeight();
            const offsetTop = vv ? vv.offsetTop : 0;
            const covered = Math.max(0, lockedHeight - visibleHeight - offsetTop);

            if (covered > 90) keyboardSeen = true;

            // Some Android browsers dismiss the keyboard without immediately
            // firing textarea.blur(). When the visual viewport grows back to
            // its original height, restore the receiver automatically.
            if (
                keyboardSeen &&
                !autoRecovering &&
                covered < 70 &&
                visibleHeight >= lockedHeight - 80
            ) {
                autoRecovering = true;
                if (document.activeElement === indexInput) indexInput.blur();
                else unlockAfterKeyboard();
                setTimeout(() => { autoRecovering = false; }, 250);
            }
        } else {
            rememberNormalHeight();
        }
    }

    if (indexInput) {
        indexInput.addEventListener('focus', lockForKeyboard);
        indexInput.addEventListener('blur', unlockAfterKeyboard);

        // Enter/Go still closes the software keyboard, but the same restoration
        // also works when Android dismisses it by tapping outside the keyboard.
        indexInput.addEventListener('keydown', event => {
            if (mobileMq.matches && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                requestAnimationFrame(() => indexInput.blur());
            }
        });
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('resize', onViewportChange);

    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (document.activeElement === indexInput) indexInput.blur();
            body.classList.remove('keyboard-lock');
            root.style.removeProperty('--keyboard-locked-height');
            rememberNormalHeight(true);
        }, 300);
    });

    rememberNormalHeight(true);

    // Existing mobile spectrum-collapse interaction is preserved unchanged.
    if (spectrumToggle && screenEl) {
        spectrumToggle.addEventListener('click', event => {
            if (!mobileMq.matches) return;
            event.preventDefault();
            const collapsed = screenEl.classList.toggle('spectrum-collapsed');
            spectrumToggle.setAttribute('aria-expanded', String(!collapsed));
            spectrumToggle.setAttribute('aria-label', collapsed ? '展开频谱' : '收起频谱');
            requestAnimationFrame(() => spectrumToggle.blur());
        });

        mobileMq.addEventListener('change', event => {
            if (!event.matches) {
                screenEl.classList.remove('spectrum-collapsed');
                spectrumToggle.setAttribute('aria-expanded', 'true');
                spectrumToggle.setAttribute('aria-label', '收起频谱');
                body.classList.remove('keyboard-lock');
                root.style.removeProperty('--keyboard-locked-height');
            } else {
                rememberNormalHeight(true);
            }
        });
    }
})();


// ===== MOBILE TOUCH POLISH v12 =====
(() => {
    const coarseMq = matchMedia('(hover: none) and (pointer: coarse)');
    const indexQuery = document.getElementById('index-query');
    const cover = document.querySelector('.release-cover');
    const cat = document.querySelector('.cat-easter');

    function fitIndexQuery() {
        if (!indexQuery) return;

        if (!coarseMq.matches) {
            indexQuery.style.height = '';
            return;
        }

        // Let the textarea wrap into the otherwise unused paper area.
        indexQuery.style.height = 'auto';
        const lineHeight = parseFloat(getComputedStyle(indexQuery).lineHeight) || 20;
        const maxHeight = lineHeight * 3.6;
        indexQuery.style.height = `${Math.min(indexQuery.scrollHeight, maxHeight)}px`;
    }

    if (indexQuery) {
        indexQuery.addEventListener('input', fitIndexQuery);
        indexQuery.addEventListener('focus', fitIndexQuery);
        fitIndexQuery();
    }

    if (cover) {
        let coverTimer = 0;
        cover.addEventListener('pointerup', event => {
            if (!coarseMq.matches || event.pointerType === 'mouse') return;
            clearTimeout(coverTimer);
            cover.classList.remove('touch-active');
            void cover.offsetWidth;
            cover.classList.add('touch-active');
            coverTimer = setTimeout(() => cover.classList.remove('touch-active'), 460);
        });
        cover.addEventListener('pointercancel', () => cover.classList.remove('touch-active'));
    }

    if (cat) {
        cat.addEventListener('click', event => {
            if (!coarseMq.matches) return;
            event.preventDefault();
            cat.classList.toggle('touch-active');
        });

        // Tapping elsewhere closes the cat message.
        document.addEventListener('pointerdown', event => {
            if (!coarseMq.matches || !cat.classList.contains('touch-active')) return;
            if (!cat.contains(event.target)) cat.classList.remove('touch-active');
        });
    }

    coarseMq.addEventListener('change', () => {
        if (!coarseMq.matches) {
            cover?.classList.remove('touch-active');
            cat?.classList.remove('touch-active');
        }
        fitIndexQuery();
    });
})();


// ===== BETWEEN STATIONS TEA PROTOTYPE =====
// Only observes the receiver's existing no-signal state; tuning and keyboard-lock stay untouched.
(() => {
  const panel = document.getElementById('no-signal');
  let lastTuneDirection = 0;
  let previousFrequency = currentFreq;
  let blankBand = null;

  // Copy is selected once per blank-band entry, never every drag frame.
  const titles = ['BETWEEN STATIONS', 'SEARCHING', 'NO SIGNAL'];
  const lines = ['TAKE YOUR TIME.', 'ALMOST THERE.', 'KEEP TUNING.',
    'MUSIC IS MY CUP OF TEA.', 'A CUP OF TEA, A LITTLE MUSIC.'];
  const pick = pool => pool[Math.floor(Math.random() * pool.length)];
  function refreshTeaCopy() {
    const title = pick(titles);
    const heading = document.getElementById('tea-title');
    const copy = document.querySelector('.tea-copy');
    heading.textContent = title;
    copy.dataset.heading =
      title === 'BETWEEN STATIONS' ? 'between' : title === 'SEARCHING' ? 'searching' : 'no-signal';

    if (title === 'BETWEEN STATIONS') {
      heading.replaceChildren(...title.split(' ').map(word => {
        const line = document.createElement('span');
        line.className = 'tea-title-line';
        line.textContent = word;
        return line;
      }));
      heading.setAttribute('aria-label', title);
    } else {
      heading.removeAttribute('aria-label');
    }

    document.getElementById('tea-line').textContent =
      lastTuneDirection && Math.random() < .35
        ? (lastTuneDirection > 0 ? 'A LITTLE TO THE RIGHT.' : 'A LITTLE TO THE LEFT.')
        : pick(lines);
    const subtitle = document.getElementById('tea-line');
    if (subtitle.textContent === 'A CUP OF TEA, A LITTLE MUSIC.') {
      subtitle.replaceChildren(...['A CUP OF TEA,', 'A LITTLE MUSIC.'].map(text => {
        const line = document.createElement('span');
        line.className = 'tea-line-part';
        line.textContent = text;
        return line;
      }));
    }
  }

  // Tea interaction: leaving SEARCHING cancels every pending pour and resets the cup.
  const scene = document.getElementById('tea-scene');
  const pot = document.getElementById('tea-pot');
  const cup = document.getElementById('tea-cup');
  cup.addEventListener('dragstart', e => e.preventDefault());
  cup.addEventListener('selectstart', e => e.preventDefault());
  // Keep a long press on the cup from opening a native menu during its drag.
  cup.addEventListener('contextmenu', e => e.preventDefault());
  const lid = pot.querySelector('.tea-lid');
  let lidDrag = null;
  let lidReturning = false;
  let lidReturnTimer = 0;
  let level = 0;
  let pouring = false;
  let emptying = false;
  let cupDrag = null;
  let suppressCupClick = false;
  let teaTimers = [];
  let clinking = false;
  let sipping = false;
  let sipAnimation = null;
  let guestCup = null;
  let toastAnimations = [];
  function later(callback, delay) {
    const timer = setTimeout(() => {
      teaTimers = teaTimers.filter(id => id !== timer);
      callback();
    }, delay);
    teaTimers.push(timer);
  }
  // Liquid visuals only: droplets live in a clipped screen layer, never in the tuner.
  const fallLayer = document.getElementById('tea-fall-layer');
  const reducedTeaMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let liquidTimers = [];
  let streamFrame = 0;
  function clearLiquid() {
    liquidTimers.forEach(clearTimeout);
    liquidTimers = [];
    cancelAnimationFrame(streamFrame);
    fallLayer.getAnimations({subtree:true}).forEach(animation => animation.cancel());
    fallLayer.replaceChildren();
    fallLayer.hidden = true;
    scene.querySelector('.tea-stream').style.opacity = '0';
  }
  function releaseLiquid(outlets, options = {}) {
    if (reducedTeaMotion.matches || panel.hidden) return;
    const count = options.count ?? 5;
    const timeScale = options.timeScale ?? 1;
    const streamMs = (options.streamMs ?? 560) * timeScale;
    const width = options.width ?? 3;
    const outlet = outlets[0];
    if (!outlet) return;

    fallLayer.hidden = false;
    const rim = outlet.getBoundingClientRect();
    const bounds = fallLayer.getBoundingClientRect();
    const x = rim.left - bounds.left;
    const y = Math.max(0, rim.top - bounds.top);
    const distance = Math.max(1, bounds.height - y);

    const stream = document.createElement('i');
    stream.className = 'tea-falling-stream';
    stream.style.left = x + 'px';
    stream.style.top = y + 'px';
    stream.style.width = width + 'px';
    fallLayer.append(stream);

    const streamAnim = stream.animate([
      {transform:'translateY(0) scaleY(.08)', opacity:0, transformOrigin:'top'},
      {transform:'translateY(0) scaleY(1)', opacity:.76, transformOrigin:'top', offset:.2},
      {transform:'translateY(' + Math.max(0, distance - 24) + 'px) scaleY(.9)', opacity:.62, transformOrigin:'top', offset:.8},
      {transform:'translateY(' + (distance + 10) + 'px) scaleY(.3)', opacity:0, transformOrigin:'top'}
    ], {duration:streamMs, easing:'cubic-bezier(.28,.02,.45,1)', fill:'forwards'});
    streamAnim.onfinish = () => stream.remove();

    for (let n = 0; n < count; n++) {
      const timer = setTimeout(() => {
        liquidTimers = liquidTimers.filter(id => id !== timer);
        if (panel.hidden) return;
        const drop = document.createElement('i');
        drop.className = 'tea-falling-drop';
        drop.style.left = (x + ((n % 3) - 1) * 2) + 'px';
        drop.style.top = (y + Math.min(14, n * 2)) + 'px';
        fallLayer.append(drop);
        const flight = drop.animate([
          {transform:'translateY(0) scaleY(1.4)', opacity:.82},
          {transform:'translateY(' + (distance + 14) + 'px) scaleY(1.15)', opacity:.72}
        ], {duration:Math.max(540, Math.sqrt(distance / 700) * 950) * timeScale, easing:'cubic-bezier(.42,0,1,1)', fill:'forwards'});
        flight.onfinish = () => drop.remove();
      }, streamMs * .45 + n * 55 * timeScale);
      liquidTimers.push(timer);
    }
  }
  function followPourStream() {
    const stream = scene.querySelector('.tea-stream');
    const started = performance.now();
    function draw(now) {
      const elapsed = now - started;
      if (panel.hidden || elapsed > 950) { stream.style.opacity = '0'; return; }
      const box = scene.getBoundingClientRect();
      const scale = box.width / scene.offsetWidth;
      const spout = scene.querySelector('.tea-spout-outlet').getBoundingClientRect();
      const rim = cup.querySelector('.tea-outlet-left').getBoundingClientRect();
      const x = (spout.left - box.left) / scale;
      const y = (spout.top - box.top) / scale;
      const dx = (rim.left - spout.left) / scale + 9;
      const dy = (rim.top - spout.top) / scale + 5;
      // Gentle gravity arc: depart the spout, then bend downward into the cup.
      stream.querySelector('path').setAttribute('d',
        'M ' + x + ' ' + y + ' Q ' + (x + dx * .72) + ' ' +
        (y + Math.max(2, dy * .1)) + ' ' + (x + dx) + ' ' + (y + dy));
      stream.style.opacity = elapsed > 290 && elapsed < 660 ? '.75' : '0';
      streamFrame = requestAnimationFrame(draw);
    }
    streamFrame = requestAnimationFrame(draw);
  }
  function setTeaLevel(next) {
    level = next;
    scene.dataset.level = String(level);
    cup.setAttribute('aria-label', 'Tea cup, level ' + level + ' of 4. Drag to empty; tap to gently rock.');
    document.getElementById('tea-level').textContent = 'TEA / ' + level + ' OF 4';
  }
  function resetTea() {
    resetLid();
    clearLiquid();
    sipAnimation?.cancel();
    sipAnimation = null;
    sipping = false;
    cup.classList.remove('is-sipping');
    toastAnimations.forEach(animation => animation.cancel());
    toastAnimations = [];
    guestCup?.remove();
    guestCup = null;
    clinking = false;
    cup.classList.remove('is-clinking');
    teaTimers.forEach(clearTimeout);
    teaTimers = [];
    pouring = emptying = suppressCupClick = false;
    if (cupDrag && cup.hasPointerCapture(cupDrag.id)) cup.releasePointerCapture(cupDrag.id);
    cupDrag = null;
    cup.style.removeProperty('transform');
    cup.classList.remove('is-rocking', 'is-dragging', 'is-emptying');
    scene.classList.remove('is-pouring', 'is-steaming', 'is-spilling');
    setTeaLevel(0);
  }
  // Lid-only drag. Clicks never pour; motion is bounded to a small upper ellipse.
  function resetLid() {
    clearTimeout(lidReturnTimer);
    const pointer = lidDrag?.id;
    lidDrag = null;
    lidReturning = false;
    if (pointer !== undefined && lid.hasPointerCapture(pointer)) lid.releasePointerCapture(pointer);
    lid.classList.remove('is-lid-dragging');
    lid.style.removeProperty('transform');
    pot.style.setProperty('--lid-opening', '0');
  }
  lid.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  lid.addEventListener('pointerdown', event => {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || lidDrag || pouring || cupDrag || emptying || clinking || sipping) return;
    resetLid();
    lidDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false};
    lid.setPointerCapture(event.pointerId);
  });
  lid.addEventListener('pointermove', event => {
    if (!lidDrag || lidDrag.id !== event.pointerId) return;
    const scale = scene.getBoundingClientRect().width / scene.offsetWidth;
    let x = (event.clientX - lidDrag.x) / scale;
    let y = (event.clientY - lidDrag.y) / scale;
    if (!lidDrag.moved && Math.hypot(x,y) < 6) return;
    lidDrag.moved = true;
    // Radius 64 horizontally, 38 upward / 22 downward in unscaled scene pixels.
    const radiusY = y < 0 ? 38 : 22;
    const distance = Math.hypot(x / 64, y / radiusY);
    if (distance > 1) { x /= distance; y /= distance; }
    lid.classList.add('is-lid-dragging');
    pot.style.setProperty('--lid-opening', String(Math.min(1, Math.hypot(x, y) / 16)));
    lid.style.transform = `translate(${x}px,${y}px) rotate(${x * .08}deg)`;
  });
  function releaseLid(event) {
    if (!lidDrag || event.pointerId !== lidDrag.id) return;
    const pointer = lidDrag.id;
    const moved = lidDrag.moved;
    lidDrag = null;
    lid.classList.remove('is-lid-dragging');
    lid.style.removeProperty('transform');
    pot.style.setProperty('--lid-opening', '0');
    if (lid.hasPointerCapture(pointer)) lid.releasePointerCapture(pointer);
    lidReturning = moved;
    if (moved) lidReturnTimer = setTimeout(() => { lidReturning = false; }, 260);
  }
  lid.addEventListener('pointerup', releaseLid);
  lid.addEventListener('pointercancel', releaseLid);
  lid.addEventListener('lostpointercapture', releaseLid);
  pot.addEventListener('click', () => {
    if (pouring || emptying || clinking || sipping || cupDrag || lidDrag || lidReturning || panel.hidden) return;
    teaTimers.forEach(clearTimeout);
    teaTimers = [];
    cup.classList.remove('is-rocking');
    pouring = true;
    const overflowPour = level === 3;
    if (overflowPour) sipping = true;
    scene.classList.add('is-pouring');
    followPourStream();
    scene.classList.remove('is-steaming', 'is-spilling');
    later(() => {
      setTeaLevel(overflowPour ? 4 : Math.min(3, level + 1));
      scene.classList.add('is-steaming');
    }, 460);
    if (overflowPour) {
      // Wait for the 550ms fill transition to reach the rim before overflowing.
      later(() => {
        scene.classList.add('is-spilling');
        releaseLiquid([...cup.querySelectorAll('.tea-outlet')], {count:5, streamMs:560, width:3});
      }, 1030);
      later(playSoloSip, 1700);
    }
    later(() => {
      scene.classList.remove('is-pouring');
      pouring = false;
    }, 980);
    later(() => scene.classList.remove('is-steaming'), 3460);
    later(() => scene.classList.remove('is-spilling'), 3260);
  });
  function playSoloSip() {
    cup.classList.add('is-sipping');
    scene.classList.remove('is-steaming');
    const scale = scene.getBoundingClientRect().width / scene.offsetWidth;
    const bounds = panel.getBoundingClientRect();
    const cupBox = cup.getBoundingClientRect();
    const right = Math.max(0, Math.min(48, (bounds.right - cupBox.right - 14) / scale));
    const up = -Math.max(0, Math.min(70, (cupBox.top - bounds.top - 14) / scale));
    const duration = reducedTeaMotion.matches ? 900 : 1900;
    if (!reducedTeaMotion.matches) {
      sipAnimation = cup.animate([
        {transform:'translate(0,0) rotate(0)',offset:0},
        {transform:`translate(${right}px,${up}px) rotate(0)`,offset:.32},
        {transform:`translate(${right}px,${up}px) rotate(12deg)`,offset:.55},
        {transform:`translate(${right}px,${up}px) rotate(0)`,offset:.78},
        {transform:'translate(0,0) rotate(0)',offset:1}
      ], {duration,easing:'ease-in-out',fill:'forwards'});
    }
    later(() => setTeaLevel(3), duration * .4);
    later(() => {
      sipAnimation?.cancel();
      sipAnimation = null;
      cup.classList.remove('is-sipping');
      sipping = false;
    }, duration);
  }
  function emptyCup(direction) {
    if (!level || emptying || clinking || sipping) return;
    emptying = true;
    scene.classList.remove('is-steaming');
    cup.style.setProperty('--tea-dump-angle', direction * 65 + 'deg');
    cup.style.setProperty('--tea-drain-angle', direction * -65 + 'deg');
    cup.style.setProperty('--tea-dump-x', direction * 15 + 'px');
    cup.style.setProperty('--tea-drain-side', direction > 0 ? '58px' : '0px');
    cup.classList.add('is-emptying');
    later(() => {
      setTeaLevel(0);
      releaseLiquid([cup.querySelector(direction > 0 ? '.tea-outlet-right' : '.tea-outlet-left')], {count:4, streamMs:620, width:4, timeScale:1.25});
    }, 325);
    later(() => {
      cup.classList.remove('is-emptying');
      emptying = false;
    }, 1025);
  }
  // Pointer travel only: 125 scene-pixel safe radius approximates the P5 circle.
  // The cup itself ALWAYS stays inside its original 24 x 14px local bounds.
  function upperLeftSector(dx, dy) {
    const angle = Math.atan2(-dy, -dx) * 180 / Math.PI;
    return dx < 0 && dy <= 0 && angle >= 0 && angle <= 75 + 1e-8;
  }
  function inClinkZone(dx, dy) {
    return upperLeftSector(dx, dy) && Math.hypot(dx, dy) > 125;
  }
  function playClink(pose) {
    clinking = true;
    suppressCupClick = true;
    scene.classList.remove('is-steaming');
    cup.classList.add('is-clinking');

    guestCup = document.createElement('div');
    guestCup.className = 'tea-guest';
    guestCup.setAttribute('aria-hidden', 'true');
    for (const selector of ['.tea-cup-handle', '.tea-bowl']) {
      guestCup.append(cup.querySelector(selector).cloneNode(true));
    }
    scene.append(guestCup);

    const originalTea = cup.querySelector('.tea-liquid');
    const guestTea = guestCup.querySelector('.tea-liquid');
    guestTea.style.height = originalTea.style.height || getComputedStyle(originalTea).height;
    const time = reducedTeaMotion.matches ? 1200 : 2700;
    const transform = (x,y,angle=0) => `translate(${x}px,${y}px) rotate(${angle}deg)`;

    if (reducedTeaMotion.matches) {
      cup.style.transform = transform(-105,-42);
      guestCup.style.transform = transform(-8,-42);
    } else {
      toastAnimations = [
        cup.animate([
          {transform:transform(pose.x,pose.y,-8),offset:0},
          {transform:transform(-102,-44),offset:.25},
          {transform:transform(-108,-44,-3),offset:.36},
          {transform:transform(-104,-45,9),offset:.57},
          {transform:transform(-102,-44),offset:.73},
          {transform:transform(0,0),offset:1}
        ], {duration:time,easing:'ease-in-out',fill:'forwards'}),
        guestCup.animate([
          {transform:transform(-43,-62),opacity:0,offset:0},
          {transform:transform(-15,-44),opacity:1,offset:.25},
          {transform:transform(-9,-44,3),opacity:1,offset:.36},
          {transform:transform(-14,-45,-9),opacity:1,offset:.57},
          {transform:transform(-16,-44),opacity:1,offset:.73},
          {transform:transform(-43,-62),opacity:0,offset:1}
        ], {duration:time,easing:'ease-in-out',fill:'forwards'})
      ];
    }

    later(() => {
      setTeaLevel(0);
      guestTea.style.height = '0px';
    }, time * .43);

    later(() => {
      toastAnimations.forEach(animation => animation.cancel());
      toastAnimations = [];
      guestCup?.remove();
      guestCup = null;
      cup.style.removeProperty('transform');
      cup.classList.remove('is-clinking');
      clinking = false;
    }, time);
  }

  cup.addEventListener('pointerdown', event => {
    if (event.button !== 0 || cupDrag || lidDrag || pouring || emptying || clinking || sipping) return;
    event.preventDefault();
    suppressCupClick = false;
    cup.classList.remove('is-rocking');
    cupDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, dx:0, dy:0, tx:0, ty:0, moved:false};
    cup.setPointerCapture(event.pointerId);
  });
  cup.addEventListener('pointermove', event => {
    if (!cupDrag || cupDrag.id !== event.pointerId) return;
    const sceneScale = scene.getBoundingClientRect().width / scene.offsetWidth;
    const dx = (event.clientX - cupDrag.x) / sceneScale;
    const dy = (event.clientY - cupDrag.y) / sceneScale;
    cupDrag.dx = dx;
    cupDrag.dy = dy;
    cupDrag.moved ||= Math.hypot(dx, dy) >= 24;
    cup.classList.add('is-dragging');

    cupDrag.tx = Math.max(-24, Math.min(24, dx));
    cupDrag.ty = Math.max(-14, Math.min(14, dy));
    cup.style.transform = `translate(${cupDrag.tx}px,${cupDrag.ty}px) rotate(${Math.max(-24, Math.min(24, dx / 2))}deg)`;
  });
  function finishCupDrag(event) {
    if (!cupDrag || cupDrag.id !== event.pointerId) return;
    const completed = event.type === 'pointerup' && cupDrag.moved;
    const direction = cupDrag.dx < 0 ? -1 : 1;
    const toast = completed && inClinkZone(cupDrag.dx, cupDrag.dy);
    const pose = {x:cupDrag.tx, y:cupDrag.ty};
    suppressCupClick = cupDrag.moved;
    cupDrag = null;
    if (cup.hasPointerCapture(event.pointerId)) cup.releasePointerCapture(event.pointerId);
    cup.classList.remove('is-dragging');
    cup.style.removeProperty('transform');
    if (toast) playClink(pose);
    else if (completed) emptyCup(direction);
  }
  cup.addEventListener('pointerup', finishCupDrag);
  cup.addEventListener('pointercancel', finishCupDrag);
  cup.addEventListener('lostpointercapture', finishCupDrag);
  cup.addEventListener('keydown', event => {
    if (event.key === 'Delete' && !pouring) {
      event.preventDefault();
      emptyCup(1);
    }
  });
  cup.addEventListener('click', event => {
    if (emptying || pouring || clinking || sipping || (suppressCupClick && event.detail !== 0)) return;
    cup.classList.remove('is-rocking');
    void cup.offsetWidth;
    cup.classList.add('is-rocking');
    later(() => cup.classList.remove('is-rocking'), 520);
  });

  function syncTeaState() {
    const visible = panel.classList.contains('visible');
    const band = visible ? Math.floor((currentFreq - 86) / 2) : null;
    if (band !== null && band !== blankBand) refreshTeaCopy();
    if (!visible && blankBand !== null) resetTea();
    blankBand = band;
    panel.hidden = !visible;
  }
  // Read the actual frequency after the original knob handler, without taking over the gesture.
  document.getElementById('tuning-knob').addEventListener('pointerdown', () => {
    previousFrequency = currentFreq;
  });
  document.getElementById('tuning-knob').addEventListener('pointermove', () => {
    if (currentFreq !== previousFrequency) lastTuneDirection = Math.sign(currentFreq - previousFrequency);
    previousFrequency = currentFreq;
  });
  new MutationObserver(syncTeaState).observe(panel, {attributes:true, attributeFilter:['class']});
  syncTeaState();
})();
