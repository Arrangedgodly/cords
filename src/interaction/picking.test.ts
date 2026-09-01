import { describe, expect, it } from 'vitest';
import { PICK_CLASS_PRIORITY, clientToNdc, createPicker } from './picking';
import type { ClientRect, HitTestProvider, PickHit } from './picking';
import type { Ray3, Vec3 } from '../sim';

/**
 * INT-1 acceptance (plan.md): "unit tests over mocked hit sets." The picker
 * never touches a renderer here — fake providers synthesize hit sets and the
 * tests pin the deterministic priority contract: class first (jack > cube >
 * cord body), then ray distance, then provider order on exact ties; cord
 * bodies excluded from grabs entirely.
 */

const RAY: Ray3 = {
  origin: { x: 0, y: 0, z: 5 },
  direction: { x: 0, y: 0, z: -1 },
};

function hit(
  hitClass: PickHit['class'],
  distance: number,
  payload: string,
  point: Vec3 | null = null,
  normal: Vec3 | null = null,
): PickHit {
  return { class: hitClass, distance, payload, point, normal };
}

function providerOf(...hits: PickHit[]): HitTestProvider {
  return { hitTest: () => hits };
}

describe('picking — grab priority (INT-1)', () => {
  it('empty hit set → null grab result and empty pick list', () => {
    const picker = createPicker(providerOf());
    expect(picker.pickGrabbable(RAY)).toBeNull();
    expect(picker.pick(RAY)).toEqual([]);
  });

  it('a farther jack beats a closer cube — class outranks distance', () => {
    const picker = createPicker(
      providerOf(hit('cube', 1, 'cube-near'), hit('jack', 4, 'jack-far')),
    );
    expect(picker.pickGrabbable(RAY)?.payload).toBe('jack-far');
  });

  it('nearer hit wins within one class', () => {
    const picker = createPicker(
      providerOf(hit('cube', 3, 'cube-back'), hit('cube', 1, 'cube-front')),
    );
    expect(picker.pickGrabbable(RAY)?.payload).toBe('cube-front');
  });

  it('exact distance ties within one class resolve to provider order — deterministic', () => {
    const picker = createPicker(
      providerOf(hit('cube', 2, 'first'), hit('cube', 2, 'second')),
    );
    expect(picker.pickGrabbable(RAY)?.payload).toBe('first');
  });
});

describe('picking — cord body is never grabbable (INT-1 rule)', () => {
  it('a cord-body-only hit set → null grab result, but pick() still reports it (INT-5 brush seam)', () => {
    const picker = createPicker(providerOf(hit('cordBody', 0.5, 'cord')));
    expect(picker.pickGrabbable(RAY)).toBeNull();
    expect(picker.pick(RAY)).toEqual([hit('cordBody', 0.5, 'cord')]);
  });

  it('a closer cord body never blocks grabbing the cube behind it', () => {
    const picker = createPicker(
      providerOf(hit('cordBody', 0.2, 'cord'), hit('cube', 2, 'cube')),
    );
    expect(picker.pickGrabbable(RAY)?.payload).toBe('cube');
  });
});

describe('picking — full ordering across classes', () => {
  it('sorts by priority class, then distance — cord body last even when nearest', () => {
    const picker = createPicker(
      providerOf(
        hit('cordBody', 0.1, 'cord'),
        hit('cube', 0.2, 'cube-near'),
        hit('jack', 3, 'jack'),
        hit('cube', 1, 'cube-far'),
      ),
    );
    expect(picker.pick(RAY).map((h) => h.payload)).toEqual([
      'jack',
      'cube-near',
      'cube-far',
      'cord',
    ]);
    // And the grab query walks that order skipping the cord body.
    expect(picker.pickGrabbable(RAY)?.payload).toBe('jack');
  });

  it('drops hits with non-finite or negative distances — a broken provider cannot corrupt the ordering', () => {
    const picker = createPicker(
      providerOf(
        hit('jack', Number.NaN, 'nan'),
        hit('cube', Number.POSITIVE_INFINITY, 'inf'),
        hit('cube', -1, 'behind-ray'),
        hit('cube', 1, 'real'),
      ),
    );
    expect(picker.pick(RAY).map((h) => h.payload)).toEqual(['real']);
    expect(picker.pickGrabbable(RAY)?.payload).toBe('real');
  });

  it('priority numbers match the approved order jack(0) < cube(1) < cordBody(2)', () => {
    expect(PICK_CLASS_PRIORITY.jack).toBe(0);
    expect(PICK_CLASS_PRIORITY.cube).toBe(1);
    expect(PICK_CLASS_PRIORITY.cordBody).toBe(2);
  });
});

describe('picking — client pixels → NDC mapping', () => {
  const RECT: ClientRect = { left: 10, top: 20, width: 200, height: 100 };

  it('maps the rect center to (0, 0)', () => {
    expect(clientToNdc(110, 70, RECT)).toEqual({ x: 0, y: 0 });
  });

  it('maps corners to the full ±1 square with y up', () => {
    expect(clientToNdc(10, 20, RECT)).toEqual({ x: -1, y: 1 }); // top-left
    expect(clientToNdc(210, 20, RECT)).toEqual({ x: 1, y: 1 }); // top-right
    expect(clientToNdc(10, 120, RECT)).toEqual({ x: -1, y: -1 }); // bottom-left
    expect(clientToNdc(210, 120, RECT)).toEqual({ x: 1, y: -1 }); // bottom-right
  });

  it('does not clamp — coordinates past the rect map beyond ±1 (they simply ray into empty space)', () => {
    expect(clientToNdc(310, 70, RECT)).toEqual({ x: 2, y: 0 });
    expect(clientToNdc(110, -30, RECT)).toEqual({ x: 0, y: 2 });
  });

  it('returns null for a degenerate rect — no NDC exists, callers treat it as off-stage', () => {
    expect(
      clientToNdc(0, 0, { left: 0, top: 0, width: 0, height: 100 }),
    ).toBeNull();
    expect(
      clientToNdc(0, 0, { left: 0, top: 0, width: 100, height: -5 }),
    ).toBeNull();
  });
});
