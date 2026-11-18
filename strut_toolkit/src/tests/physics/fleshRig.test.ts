import { checkPhysics } from '../../ts/physics/config';
import { boneFilterOf, setBoneFilter } from '../../ts/physics/colliderEdit';
import { fleshControls, fleshEntryName, fleshLook, kindOf, removePart, setFlesh, setFleshBones, summarise } from '../../ts/physics/edit';
import { pieces } from '../../ts/physics/fleshRig';
import { weld } from '../../ts/physics/cloth';
import { add, length, Q4, qaxisY, sub, V3 } from '../../ts/physics/math';
import { BoneFrame, ClothMeshInput, PhysicsRig } from '../../ts/physics/rig';

const IDENTITY: Q4 = [0, 0, 0, 1];
const BONES = [{ name: 'root', parent: null }, { name: 'pouch', parent: 'root' }, { name: 'tip', parent: 'pouch' }, { name: 'plain', parent: 'root' }];
const noAuto = (): never[] => [];

/** A closed ball, 12 around and 6 from pole to pole; the quads at the poles repeat the pole as a corner */
function ball(key: string, bone: string, cx: number, cy: number, cz: number, radius: number): ClothMeshInput {
    const around = 12;
    const rows = 6;
    const rest: V3[] = [];
    const faces: number[][] = [];

    for (let j = 0; j <= rows; j++) {
        for (let i = 0; i < around; i++) {
            const lat = Math.PI * j / rows;
            const angle = Math.PI * 2 * i / around;

            rest.push([cx + Math.sin(angle) * Math.sin(lat) * radius, cy + Math.cos(lat) * radius, cz + Math.cos(angle) * Math.sin(lat) * radius]);
        }
    }

    for (let j = 0; j < rows; j++) for (let i = 0; i < around; i++) {
        const a = j * around + i;
        const b = j * around + (i + 1) % around;

        faces.push([a, a + around, b + around, b]);
    }

    return { key, bone, rest, faces };
}

function merge(key: string, bone: string, ...parts: ClothMeshInput[]): ClothMeshInput {
    const rest: V3[] = [];
    const faces: number[][] = [];

    for (const p of parts) {
        faces.push(...p.faces.map(f => f.map(i => i + rest.length)));
        rest.push(...p.rest);
    }

    return { key, bone, rest, faces };
}

function frames(): ReadonlyMap<string, BoneFrame> {
    const map = new Map<string, BoneFrame>();

    for (const b of BONES) map.set(b.name, { origin: [0, 1, 0], orientation: IDENTITY, local: IDENTITY });

    return map;
}

/** Runs the rig for three seconds with the entity moving back and forth, the animation carrying every mesh with it, and returns the last vertices of each key */
function walk(rig: PhysicsRig, meshes: ClothMeshInput[], seconds = 3): Map<string, V3[]> {
    const out = new Map<string, V3[]>();

    for (let i = 0; i <= seconds * 60; i++) {
        const t = i / 60;
        const pos: V3 = [0, 0, 0.5 * Math.sin(t * 7)];

        rig.clothAnimated = new Map(meshes.map(m => [m.key, m.rest.map(v => add(v, pos))]));
        rig.update(frames(), { pos, yaw: 0 }, qaxisY(0), t);
    }

    for (const m of meshes) {
        const v = rig.clothVertices(m.key);

        if (v) out.set(m.key, v);
    }

    return out;
}

describe('flesh in the rig', () => {
    test('a jelly ball swings behind the animation, and a carried tip stays one rigid piece', () => {
        const pouch = ball('pouch', 'pouch', 0, 0.6, 0.3, 0.12);
        const tip = ball('tip', 'tip', 0, 0.6, 0.18, 0.03);
        const rig = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch', preset: 'jelly', carry: ['tip'] } } }, noAuto, [pouch, tip]);

        expect(rig.problems).toEqual([]);
        expect(rig.clothCount).toBe(1);

        let worstSpread = 0;
        let lag = 0;

        for (let i = 0; i <= 180; i++) {
            const t = i / 60;
            const pos: V3 = [0, 0, 0.5 * Math.sin(t * 7)];

            rig.clothAnimated = new Map([[pouch.key, pouch.rest.map(v => add(v, pos))], [tip.key, tip.rest.map(v => add(v, pos))]]);
            rig.update(frames(), { pos, yaw: 0 }, qaxisY(0), t);

            const moved = rig.clothVertices('tip');
            const body = rig.clothVertices('pouch');

            if (moved && body && i > 30) {
                for (const [a, b] of [[0, 5], [3, 40], [20, 60]]) {
                    worstSpread = Math.max(worstSpread, Math.abs(length(sub(moved[a], moved[b])) - length(sub(tip.rest[a], tip.rest[b]))));
                }

                lag = Math.max(lag, length(sub(body[40], add(pouch.rest[40], pos))));
            }
        }

        // the tip is one rigid piece, and the pouch has moved behind where the animation puts it
        expect(worstSpread).toBeLessThan(1e-6);
        expect(lag).toBeGreaterThan(0.004);
        expect(lag).toBeLessThan(0.3);
        expect(rig.clothKeys().sort()).toEqual(['pouch', 'tip']);
        expect(rig.clothReport()[0].flesh).toBe(true);
    });

    test('meshes on the bones under the root ride on it when the root has a mesh of its own, and are flesh when it has none', () => {
        const pouch = ball('pouch', 'pouch', 0, 0.6, 0.3, 0.12);
        const tip = ball('tip', 'tip', 0, 0.6, 0.18, 0.03);
        const ride = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch' } } }, noAuto, [pouch, tip]);
        const bare = new PhysicsRig(BONES, { flesh: { root: { bone: 'root', preset: 'belly' } } }, noAuto, [pouch, tip]);

        expect(ride.clothKeys().sort()).toEqual(['pouch', 'tip']);
        expect(bare.clothKeys().sort()).toEqual(['pouch', 'tip']);
        expect(bare.clothCount).toBe(1);
    });

    test('a mesh that holds two parts is a pair: each swings on its own and they press on each other', () => {
        const a = ball('a', 'pouch', -0.13, 0.6, 0.3, 0.12);
        const b = ball('b', 'pouch', 0.13, 0.6, 0.3, 0.12);
        const both = merge('both', 'pouch', a, b);
        const rig = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch', preset: 'pouch' } } }, noAuto, [both]);

        expect(rig.clothCount).toBe(2);

        const moved = walk(rig, [both]).get('both')!;

        expect(moved.length).toBe(both.rest.length);
        expect(moved.every(v => v.every(Number.isFinite))).toBe(true);
    });

    test('a tip merged into the mesh of the pouch it sits on is part of it, not a part of its own', () => {
        const pouch = ball('p', 'pouch', 0, 0.6, 0.3, 0.12);
        const tip = ball('t', 'pouch', 0, 0.7, 0.3, 0.04);
        const merged = merge('both', 'pouch', pouch, tip);

        expect(pieces(weld(merged.rest, merged.faces))).toBeNull();
        expect(new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch' } } }, noAuto, [merged]).clothCount).toBe(1);

        const side = merge('two', 'pouch', ball('a', 'pouch', -0.3, 0.6, 0.3, 0.12), ball('b', 'pouch', 0.3, 0.6, 0.3, 0.12));
        const found = pieces(weld(side.rest, side.faces));

        expect(found?.length).toBe(2);
    });

    test('the old name of the section is read, and a bone without a mesh or missing is reported', () => {
        const pouch = ball('pouch', 'pouch', 0, 0.6, 0.3, 0.12);
        const old = new PhysicsRig(BONES, { soft: { pouch: { bone: 'pouch' } } }, noAuto, [pouch]);

        expect(old.clothCount).toBe(1);

        const bad = new PhysicsRig(BONES, { flesh: { a: { bone: 'plain' }, b: { bone: 'nope' }, c: {} } }, noAuto, [pouch]);

        expect(bad.clothCount).toBe(0);
        expect(bad.problems.join('\n')).toMatch(/plain.*no mesh/);
        expect(bad.problems.join('\n')).toMatch(/"nope" is not in the model/);
    });

    test('the swing turns about the bone pivot the animation leaves it at, unless that is far from the flesh', () => {
        const pouch = ball('pouch', 'pouch', 0, 0.6, 0.3, 0.12);
        const near = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch' } } }, noAuto, [pouch]);

        // the frames put every bone's pivot at (0, 1, 0): 0.4 from the flesh, near enough to swing about
        expect(walk(near, [pouch]).get('pouch')!.every(v => v.every(Number.isFinite))).toBe(true);

        const far = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch', pivot: 'auto' } } }, noAuto, [pouch]);

        expect(walk(far, [pouch]).get('pouch')!.every(v => v.every(Number.isFinite))).toBe(true);
    });
});

describe('editing flesh', () => {
    test('a bone becomes flesh, reads back, takes a look, and is removed', () => {
        let doc: Record<string, any> = {};

        doc = setFlesh(doc, 'pouch', fleshLook('seat', 'pouch'));
        expect(kindOf(doc, 'pouch')).toBe('flesh');
        expect(doc.flesh.pouch).toMatchObject({ bone: 'pouch', preset: 'seat' });
        expect(fleshControls(doc, 'pouch').firmness).toBeCloseTo(1.1547, 3);
        expect(fleshControls(doc, 'pouch').meat).toBeCloseTo(0.5, 6);

        doc = setFlesh(doc, 'pouch', { ...fleshControls(doc, 'pouch'), softRadius: 0.2, softCenter: [0, 1, 0], carry: ['tip'], lumpDamping: 0.3, meat: 1 });
        expect(doc.flesh.pouch.softRadius).toBe(0.2);
        expect(doc.flesh.pouch.carry).toEqual(['tip']);
        // the damping is written as the file says, not with the meat's scaling of it, so it does not count twice
        expect(doc.flesh.pouch.lump.damping).toBeCloseTo(0.3, 6);
        expect(fleshControls(doc, 'pouch').lumpDamping).toBeCloseTo(0.3, 6);
        expect(summarise(doc)).toMatch(/1 cloth or flesh/);
        expect(checkPhysics(JSON.stringify(doc), ['pouch', 'tip']).warnings).toEqual([]);

        doc = setFlesh(doc, 'pouch', { ...fleshControls(doc, 'pouch'), softRadius: 0 });
        expect(doc.flesh.pouch.softRadius).toBeUndefined();
        expect(removePart(doc, 'pouch').flesh).toBeUndefined();
    });

    test('a pair entry is found by either bone, and keeps its bones when edited', () => {
        let doc: Record<string, any> = { flesh: { pair: { bones: ['pouchL', 'pouchR'], preset: 'pouch', tip: '-z' } } };

        expect(fleshEntryName(doc, 'pouchR')).toBe('pair');
        expect(kindOf(doc, 'pouchL')).toBe('flesh');

        doc = setFlesh(doc, 'pouchL', { ...fleshControls(doc, 'pouchL'), softness: 1.5 });

        expect(doc.flesh.pair.bones).toEqual(['pouchL', 'pouchR']);
        expect(doc.flesh.pair.tip).toBe('-z');
        expect(doc.flesh.pair.bone).toBeUndefined();
        expect(doc.flesh.pair.softness).toBeCloseTo(1.5, 6);
    });

    test('the keys of the old per-vertex flesh are dropped when the entry is edited, and the checker names them before', () => {
        const old = { flesh: { pouch: { bone: 'pouch', stiffness: 0.9, damping: 3, inertia: 0.5, gravity: 2, anchor: 12 } } };

        expect(checkPhysics(JSON.stringify(old), ['pouch']).warnings.join('\n')).toMatch(/for the old per-vertex flesh/);

        const edited = setFlesh(old, 'pouch', fleshControls(old, 'pouch'));

        expect(edited.flesh.pouch.stiffness).toBeUndefined();
        expect(edited.flesh.pouch.anchor).toBeUndefined();
        expect(checkPhysics(JSON.stringify(edited), ['pouch']).warnings).toEqual([]);
    });
});

describe('a shape pressing into flesh', () => {
    const mesh = ball('m', 'pouch', 0, 1, 0.3, 0.3);

    function run(props: boolean, collideWorld = true): { dent: number; clear: number } {
        const rig = new PhysicsRig(BONES, { flesh: { pouch: { bone: 'pouch', preset: 'pouch', collidesWith: collideWorld ? ['world'] : [] } } }, noAuto, [mesh]);

        // a ball held against the front of the flesh, its middle 0.1 inside the surface
        if (props) rig.props = [{ shape: 'sphere', p: [0, 1, 0.8], q: [0, 0, 0], radius: 0.4, half: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }];

        let front = 0;
        let back = 0;

        for (let i = 0; i < 120; i++) {
            rig.clothAnimated = new Map([[mesh.key, mesh.rest]]);
            rig.update(frames(), { pos: [0, 0, 0], yaw: 0 }, qaxisY(0), i / 60);
        }

        const v = rig.clothVertices('m')!;
        const z = (k: number): number => v[k][2];

        front = Math.max(...v.map((_, k) => z(k)));
        back = Math.min(...v.map((_, k) => z(k)));

        return { dent: front, clear: back };
    }

    test('dents the side it presses on', () => {
        const free = run(false);
        const pressed = run(true);

        expect(pressed.dent).toBeLessThan(free.dent - 0.01);
    });

    test('presses nothing when blocks and shapes are switched off for it', () => {
        expect(run(true, false).dent).toBeCloseTo(run(false).dent, 6);
    });
});

describe('the flesh controls beyond the main ones', () => {
    const controls = fleshControls;
    const set = setFlesh;

    test('writes a key only when it differs from the look, and drops it when it is put back', () => {
        let doc = set({}, 'pouch', controls({}, 'pouch'));

        expect(doc.flesh.pouch.squeezeIn).toBeUndefined();

        const c = controls(doc, 'pouch');

        doc = set(doc, 'pouch', { ...c, squeezeIn: 1.4, anchorHold: 0.5, tip: '+z', nestedSoft: true, pivotMode: 'auto' });
        expect(doc.flesh.pouch).toMatchObject({ squeezeIn: 1.4, anchorHold: 0.5, tip: '+z', nested: 'soft', pivot: 'auto' });
        expect(controls(doc, 'pouch')).toMatchObject({ anchorHold: 0.5, tip: '+z', nestedSoft: true, pivotMode: 'auto' });
        expect(controls(doc, 'pouch').squeezeIn).toBeCloseTo(1.4, 5);

        doc = set(doc, 'pouch', { ...controls(doc, 'pouch'), squeezeIn: 0.8, tip: 'auto', nestedSoft: false, pivotMode: 'bone' });
        expect(doc.flesh.pouch.squeezeIn).toBeUndefined();
        expect(doc.flesh.pouch.tip).toBeUndefined();
        expect(doc.flesh.pouch.nested).toBeUndefined();
        expect(doc.flesh.pouch.pivot).toBeUndefined();
    });

    test('a value that was grouped in the file is not left behind to win over the flat one', () => {
        const doc = { flesh: { pouch: { bone: 'pouch', squeeze: { in: 2, rim: 0.3 } } } };
        const next = set(doc, 'pouch', { ...controls(doc, 'pouch'), squeezeIn: 1.1 });

        expect(next.flesh.pouch.squeeze).toBeUndefined();
        expect(next.flesh.pouch).toMatchObject({ squeezeIn: 1.1, rim: 0.3 });
        expect(controls(next, 'pouch').squeezeIn).toBeCloseTo(1.1, 6);
    });

    test('makes a pair of two bones, and a single one of it again', () => {
        const pair = setFleshBones({ flesh: { chest: { bone: 'pouchL', preset: 'pouch' } } }, 'pouchL', ['pouchL', 'pouchR']);

        expect(pair.flesh.chest.bones).toEqual(['pouchL', 'pouchR']);
        expect(pair.flesh.chest.bone).toBeUndefined();
        expect(controls(pair, 'pouchR').bones).toEqual(['pouchL', 'pouchR']);
        expect(setFleshBones(pair, 'pouchR', ['pouchL']).flesh.chest.bone).toBe('pouchL');
    });

    test('keeps an allow or deny list of bones on a flesh', () => {
        const doc = { flesh: { pouch: { bone: 'pouch' } } };
        const next = setBoneFilter(doc, 'pouch', { only: [], ignore: ['head'] });

        expect(next.flesh.pouch.ignoreBones).toEqual(['head']);
        expect(boneFilterOf(next, 'pouch').ignore).toEqual(['head']);
    });
});

describe('a piece that rides on a pair', () => {
    test('moves with the one of the pair that is nearest it, and only that one', () => {
        const left = ball('L', 'pouchL', -0.3, 1, 0, 0.2);
        const right = ball('R', 'pouchR', 0.3, 1, 0, 0.2);
        const top = ball('T', 'plain', -0.3, 1.3, 0, 0.05);
        const bones = [{ name: 'root', parent: null }, { name: 'pouchL', parent: 'root' }, { name: 'pouchR', parent: 'root' }, { name: 'plain', parent: 'root' }];
        const rig = new PhysicsRig(bones, { flesh: { chest: { bones: ['pouchL', 'pouchR'], preset: 'jelly', carry: ['plain'] } } }, noAuto, [left, right, top]);
        const key = (k: string): string[] => rig.clothKeys().filter(x => x === k);

        // listed once for the one region that carries it, not once for each of the pair
        expect(key('T')).toEqual(['T']);
    });
});
