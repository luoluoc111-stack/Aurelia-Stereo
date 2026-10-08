(() => {
  const input = document.getElementById('index-query');
  const body = document.body;
  const root = document.documentElement;
  const unit = document.getElementById('radio-unit');
  const machine = document.getElementById('typewriter-machine');
  const status = document.getElementById('status');

  const dInner = document.getElementById('d-inner');
  const dVv = document.getElementById('d-vv');
  const dOffset = document.getElementById('d-offset');
  const dLock = document.getElementById('d-lock');

  const mobileMq = matchMedia('(max-width:700px)');
  let lockedHeight = 0;
  let lockedScrollY = 0;
  let restoreTimer = 0;
  let keyboardSeen = false;
  let autoRecovering = false;

  function viewportHeight() {
    return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  }

  function writeDebug() {
    const vv = window.visualViewport;
    dInner.textContent = `innerHeight: ${Math.round(window.innerHeight || 0)}`;
    dVv.textContent = `visualViewport: ${vv ? Math.round(vv.height) : 'n/a'}`;
    dOffset.textContent = `offsetTop: ${vv ? Math.round(vv.offsetTop) : 'n/a'}`;
    dLock.textContent = `lockedHeight: ${Math.round(lockedHeight || 0)}`;

    if (!mobileMq.matches) {
      status.textContent = 'DESKTOP';
      return;
    }

    if (!body.classList.contains('keyboard-lock')) {
      status.textContent = 'READY';
      return;
    }

    const visible = vv ? vv.height : viewportHeight();
    const covered = Math.max(0, lockedHeight - visible - (vv?.offsetTop || 0));
    if (covered > 90) keyboardSeen = true;
    status.textContent = keyboardSeen ? `KEYBOARD ${Math.round(covered)}PX` : 'FOCUS LOCK';
  }

  function lockForKeyboard() {
    if (!mobileMq.matches || body.classList.contains('keyboard-lock')) return;

    clearTimeout(restoreTimer);
    keyboardSeen = false;
    lockedHeight = viewportHeight();
    lockedScrollY = window.scrollY || 0;

    root.style.setProperty('--locked-height', `${lockedHeight}px`);

    body.classList.add('keyboard-lock');

    // Prevent the document itself from being the thing the browser pans.
    window.scrollTo(0, lockedScrollY);
    writeDebug();
  }

  function canUnlock() {
    const vv = window.visualViewport;
    if (!vv) return true;
    return vv.height >= lockedHeight - 80;
  }

  function unlockAfterKeyboard() {
    if (!body.classList.contains('keyboard-lock')) return;

    clearTimeout(restoreTimer);

    const attempt = (tries = 0) => {
      if (canUnlock() || tries >= 8) {
        body.classList.remove('keyboard-lock');
        // Do not immediately replace --locked-height with the shrunken keyboard viewport.
        setTimeout(() => {
          const h = viewportHeight();
          root.style.setProperty('--locked-height', `${h}px`);
          lockedHeight = h;
          writeDebug();
        }, 120);

        window.scrollTo(0, lockedScrollY);
        keyboardSeen = false;
        status.textContent = 'READY';
        return;
      }
      restoreTimer = setTimeout(() => attempt(tries + 1), 80);
    };

    restoreTimer = setTimeout(() => attempt(0), 60);
  }

  function onViewportChange() {
    if (body.classList.contains('keyboard-lock')) {
      // Some Android browsers pan the visual viewport while focusing.
      // We intentionally do not resize/reposition the receiver from vv.height.
      window.scrollTo(0, lockedScrollY);

      const vv = window.visualViewport;
      const visibleHeight = vv ? vv.height : viewportHeight();
      const offsetTop = vv ? vv.offsetTop : 0;
      const covered = Math.max(0, lockedHeight - visibleHeight - offsetTop);

      // Important Android case:
      // the OS keyboard can be dismissed without textarea.blur() firing.
      // Once we have actually seen a keyboard-sized viewport reduction,
      // treat a recovered viewport as "keyboard closed" and restore immediately.
      if (
        keyboardSeen &&
        !autoRecovering &&
        covered < 70 &&
        visibleHeight >= lockedHeight - 80
      ) {
        autoRecovering = true;

        // Blur is intentional here: the user has dismissed the OS keyboard,
        // so keeping a hidden focused textarea only creates a stale input state.
        if (document.activeElement === input) {
          input.blur();
        } else {
          unlockAfterKeyboard();
        }

        setTimeout(() => {
          autoRecovering = false;
        }, 250);
      }
    } else if (mobileMq.matches) {
      const h = viewportHeight();
      lockedHeight = h;
      root.style.setProperty('--locked-height', `${h}px`);
    }
    writeDebug();
  }

  input.addEventListener('focus', () => {
    lockForKeyboard();
    setTimeout(writeDebug, 50);
    setTimeout(writeDebug, 180);
  });

  input.addEventListener('blur', () => {
    unlockAfterKeyboard();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 24;
    input.style.height = `${Math.min(input.scrollHeight, lineHeight * 3)}px`;
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    }
  });

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', onViewportChange);
    visualViewport.addEventListener('scroll', onViewportChange);
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (document.activeElement === input) input.blur();
      lockedHeight = viewportHeight();
      root.style.setProperty('--locked-height', `${lockedHeight}px`);
      writeDebug();
    }, 300);
  });

  mobileMq.addEventListener('change', () => {
    if (!mobileMq.matches) {
      body.classList.remove('keyboard-lock');
      root.style.removeProperty('--locked-height');
    } else {
      lockedHeight = viewportHeight();
      root.style.setProperty('--locked-height', `${lockedHeight}px`);
    }
    writeDebug();
  });

  lockedHeight = viewportHeight();
  root.style.setProperty('--locked-height', `${lockedHeight}px`);
  writeDebug();
})();

// ===== BETWEEN STATIONS TEA PROTOTYPE =====
// Standalone demo: do not alter the keyboard-lock IIFE above.
(() => {
  const names = ['PLAY','STORY','INDEX','CREDITS','NOTES','VISUALS','ARCHIVE','END'];
  const panel = document.getElementById('no-signal');
  const index = document.getElementById('station-index');
  const preview = document.getElementById('tea-station-preview');
  const tune = document.querySelector('.control-row .knob');
  const dial = tune.querySelector('i');
  const scale = document.querySelector('.scale-line');
  const labels = [...document.querySelectorAll('.scale-labels > span')];
  let frequency = 90;
  let lastTuneDirection = 0;
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

  function renderFrequency() {
    const nearest = Math.round((frequency - 86) / 2);
    const locked = Math.abs(frequency - (86 + nearest * 2)) <= .25;
    const band = locked ? null : Math.floor((frequency - 86) / 2);
    if (band !== null && band !== blankBand) refreshTeaCopy();
    if (locked && blankBand !== null) resetTea();
    blankBand = band;
    panel.hidden = locked;
    index.hidden = !locked || nearest !== 2;
    preview.hidden = !locked || nearest === 2;
    if (!preview.hidden) {
      document.getElementById('tea-preview-tag').textContent = (86 + nearest * 2) + ' / ' + names[nearest];
      document.getElementById('tea-preview-title').textContent = names[nearest];
    }
    labels.forEach((label, i) => label.classList.toggle('active', locked && i === nearest));
    document.querySelector('.readout small').textContent = locked ? names[nearest] : 'BETWEEN';
    document.querySelector('.readout strong').textContent = frequency.toFixed(1);
    tune.setAttribute('aria-valuenow', frequency.toFixed(1));
    tune.setAttribute('aria-valuetext', frequency.toFixed(1) + ' FM, ' + (locked ? names[nearest] : 'between stations'));
    dial.style.transform = 'rotate(' + ((frequency - 86) / 14 * 270 - 77) + 'deg)';
    scale.style.setProperty('--tea-position', ((frequency - 86) / 14 * 100) + '%');
  }

  // Previous actual frequency delta, not cursor position, determines the hint.
  function tuneTo(value) {
    // Leave the active Android keyboard session entirely to the original code.
    if (document.body.classList.contains('keyboard-lock')) return;
    const next = Math.max(86, Math.min(100, Math.round(value * 10) / 10));
    if (next === frequency) return;
    lastTuneDirection = Math.sign(next - frequency);
    frequency = next;
    renderFrequency();
  }
  tune.dataset.teaTune = '';
  tune.tabIndex = 0;
  tune.setAttribute('role', 'slider');
  tune.setAttribute('aria-label', 'Tune frequency. Drag right or up to increase; left or down to decrease.');
  tune.setAttribute('aria-valuemin', '86');
  tune.setAttribute('aria-valuemax', '100');
  scale.classList.add('tea-tuning-line');
  let drag = null;
  tune.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || document.body.classList.contains('keyboard-lock')) return;
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, start:frequency};
    tune.setPointerCapture(event.pointerId);
  });
  tune.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    tuneTo(drag.start + ((event.clientX - drag.x) - (event.clientY - drag.y)) / 24);
  });
  const stopDrag = () => { drag = null; };
  tune.addEventListener('pointerup', stopDrag);
  tune.addEventListener('pointercancel', stopDrag);
  tune.addEventListener('lostpointercapture', stopDrag);
  tune.addEventListener('keydown', event => {
    const steps = {ArrowRight:.1, ArrowUp:.1, ArrowLeft:-.1, ArrowDown:-.1};
    if (!(event.key in steps)) return;
    event.preventDefault();
    tuneTo(frequency + steps[event.key]);
  });

  // Tea interaction: leaving SEARCHING cancels every pending pour and resets the cup.
  const scene = document.getElementById('tea-scene');
  const pot = document.getElementById('tea-pot');
  const cup = document.getElementById('tea-cup');
  cup.addEventListener('dragstart', e => e.preventDefault());
  cup.addEventListener('selectstart', e => e.preventDefault());
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
  renderFrequency();
})();
