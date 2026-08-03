import * as THREE from 'three';
import { ParticleSystem } from './src/particles.js';

/**
 * test_particles_v1: the live-particle bookkeeping behind the idle skip.
 *
 * WHY THIS TEST EXISTS AT ALL — AND WHY IT IS THE FIRST CLIENT-SIDE TEST:
 * ParticleSystem.update() now skips its whole per-frame matrix rebuild and GPU
 * upload when `liveCount === 0`. That makes a counter the gate on a real
 * optimisation, and a counter that drifts up by one and never returns to zero
 * would silently disable the optimisation forever while everything still LOOKED
 * correct on screen — no visual symptom, no error, just the old ~11 MB/s cost
 * quietly restored. The ring buffer makes it easy to get wrong: wrapping onto a
 * still-living particle replaces it and must NOT increment the count.
 *
 * It runs headlessly because THREE.Scene / InstancedMesh construct fine without a
 * WebGL context — only rendering needs a GPU. So this obeys R01 like the engine
 * tests do, despite living in the render engine.
 *
 * Assertion style, runner shape and exit-code contract are copied from
 * 03_Stable_Build/test_ledger_v1.js deliberately (ponytail Rung 2 — reuse the
 * existing harness pattern rather than introduce a second one).
 *
 * Big-O: O(T * P) for T cases over P particle slots.
 */

function runTests() {
  let allPassed = true;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.log(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  };

  const emitOne = (ps, life = 1.0) =>
    ps.emit({
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 1, 0),
      life,
      startScale: 1,
      endScale: 0,
      color: 0xffffff,
    });

  // Test 1: a fresh system is idle, and an idle system hides itself and does no work.
  (() => {
    const ps = new ParticleSystem(new THREE.Scene(), 8);
    assert(ps.liveCount === 0, 'T1: fresh system has liveCount 0');

    // WHY `version` AND NOT `needsUpdate`: three's BufferAttribute.needsUpdate is a
    // WRITE-ONLY setter (it just bumps `version`), so reading it back always yields
    // undefined and an assertion against true/false can never pass. `version` is the
    // observable that actually records "this buffer was flagged for upload".
    const v0 = ps.mesh.instanceMatrix.version;
    ps.update(0.016);
    assert(ps.mesh.visible === false, 'T1: idle system hides its mesh (draw call skipped)');
    assert(
      ps.mesh.instanceMatrix.version === v0,
      'T1: idle system flags no GPU upload — this is the whole point of the skip'
    );
  })();

  // Test 2: emitting makes it live and visible, and the upload happens again.
  (() => {
    const ps = new ParticleSystem(new THREE.Scene(), 8);
    ps.update(0.016); // go idle/hidden first
    emitOne(ps);
    emitOne(ps);
    emitOne(ps);
    assert(ps.liveCount === 3, 'T2: three emits give liveCount 3');

    const v0 = ps.mesh.instanceMatrix.version;
    ps.update(0.016);
    assert(ps.mesh.visible === true, 'T2: a live system is visible again');
    assert(
      ps.mesh.instanceMatrix.version > v0,
      'T2: a live system does upload matrices'
    );
    assert(ps.liveCount === 3, 'T2: a short step kills nothing');
  })();

  // Test 3: particles expire and the count returns to exactly zero.
  // A count that never reaches 0 is the failure mode that silently kills the skip.
  (() => {
    const ps = new ParticleSystem(new THREE.Scene(), 8);
    emitOne(ps, 0.5);
    emitOne(ps, 0.5);
    assert(ps.liveCount === 2, 'T3: two live before expiry');

    ps.update(1.0); // past both lifetimes
    assert(ps.liveCount === 0, 'T3: liveCount returns to exactly 0 after expiry');

    ps.update(0.016);
    assert(ps.mesh.visible === false, 'T3: system goes back to hidden once empty');
  })();

  // Test 4: THE RING-BUFFER TRAP. Overwriting a LIVING particle must not raise the
  // count — otherwise heavy emission drifts liveCount above the real population, it
  // never returns to 0, and the idle skip is dead for the rest of the session.
  (() => {
    const cap = 4;
    const ps = new ParticleSystem(new THREE.Scene(), cap);
    for (let i = 0; i < cap * 3; i++) emitOne(ps); // wrap the buffer three times over
    assert(
      ps.liveCount === cap,
      `T4: liveCount is capped at the buffer size (${cap}), got ${ps.liveCount} — ` +
        'overwriting a live slot must not increment'
    );

    ps.update(2.0); // outlive everything
    assert(ps.liveCount === 0, 'T4: count still returns to 0 after heavy wrap-around');
  })();

  // Test 5: reclaiming a DEAD slot must increment. The mirror of T4 — a guard that
  // is too aggressive would leave liveCount at 0 while particles are alive, and the
  // skip would hide particles that should be on screen.
  (() => {
    const ps = new ParticleSystem(new THREE.Scene(), 4);
    emitOne(ps, 0.5);
    ps.update(1.0); // it dies; slot 0 is now free, index has moved on
    assert(ps.liveCount === 0, 'T5: precondition — system is empty');

    emitOne(ps, 1.0);
    assert(ps.liveCount === 1, 'T5: reclaiming a dead slot DOES increment');
    ps.update(0.016);
    assert(ps.mesh.visible === true, 'T5: and the system becomes visible again');
  })();

  if (allPassed) {
    console.log('\nALL TESTS PASSED ✅');
    process.exit(0);
  } else {
    console.log('\nSOME TESTS FAILED ❌');
    process.exit(1);
  }
}

runTests();
