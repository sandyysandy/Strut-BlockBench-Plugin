import { decodeAnimation, RawChannel, RawKey } from '../ts/binary/animation';
import { eulerOf, foldStageOffset } from '../ts/stage/stageFold';
import { exportStage } from '../ts/stage/stageExport';
import { checkStage, newStage, parseStage, serializeStage, Stage, StageActor } from '../ts/stage/stageFormat';
import { qfromEulerDegrees } from '../ts/physics/math';

const key = (time: number, value: [number, number, number], extra: Partial<RawKey> = {}): RawKey => ({
    time, interpolation: 'LINEAR', value: { literals: value, expressions: [null, null, null] }, post: null, easing: null, easingArgs: [], bezier: null, ...extra,
});
const channel = (target: string, property: 'ROTATION' | 'POSITION' | 'SCALE', keys: RawKey[]): RawChannel => ({ target, targetKind: 'GROUP_BONE', property, interpolation: 'LINEAR', keys });

const host: StageActor = { role: 'host', skeleton: 'mymod:creature_a', roots: [{ bone: 'root', pivot: [0, 0, 0] }], offset: { position: [0, 0, 0], yaw: 0 }, compatible: ['mymod:creature_b'] };
const male: StageActor = { role: 'male', skeleton: 'mymod:human', roots: [{ bone: 'root', pivot: [0, 0, 0] }], offset: { position: [10, 0, 0], yaw: 180 }, required: false, lead: true, camera: 'eye' };

function stage(): Stage {
    return {
        ...newStage('doggy', 'mymod'),
        actors: [host, male],
        animations: [{
            name: 'animation.doggy.slow', duration: 1.5, loop: 'LOOP',
            tracks: {
                host: { channels: [channel('hips', 'ROTATION', [key(0, [0, 0, 0]), key(1, [10, 0, 0])])], events: [{ time: 0.5, kind: 'sound', payload: 'mymod:thud', authority: 0 }] },
                male: { channels: [channel('root', 'POSITION', [key(0, [0, 0, 0]), key(1, [0, 0, 4])]), channel('arm', 'ROTATION', [key(0, [5, 0, 0])])], events: [], shift: 0.25 },
            },
        }],
    };
}

const none = { position: [0, 0, 0] as [number, number, number], yaw: 0 };

describe('the workspace file', () => {
    test('a stage reads back as it was written', () => {
        expect(parseStage(serializeStage(stage()))).toEqual(stage());
    });

    test('a damaged file is refused with what is wrong, not half loaded', () => {
        expect(() => parseStage('nope')).toThrow(/not valid JSON/);
        expect(() => parseStage('{"format":"other"}')).toThrow(/not a Strut workspace/);
        expect(() => parseStage(serializeStage({ ...stage(), version: 99 }))).toThrow(/newer/);
        expect(() => parseStage(serializeStage({ ...stage(), actors: [host, host] }))).toThrow(/two actors/);

        const bad = JSON.parse(serializeStage(stage()));

        bad.animations[0].tracks.third = { channels: [], events: [] };
        expect(() => parseStage(JSON.stringify(bad))).toThrow(/"third"/);
    });

    test('the checks: an actor with no valid skeleton id is an error, an idle actor a warning', () => {
        const noId = { ...stage(), actors: [{ ...host, skeleton: '' }, male] };

        expect(checkStage(noId).filter(p => p.severity === 'error').map(p => p.message)).toEqual([expect.stringContaining('no skeleton id')]);
        expect(checkStage({ ...stage(), actors: [{ ...host, skeleton: 'creature' }, male] }).some(p => p.severity === 'error')).toBe(true);
        expect(checkStage({ ...stage(), animations: [{ ...stage().animations[0], tracks: {} }] }).filter(p => p.severity === 'warning')).toHaveLength(2);
        expect(checkStage(stage()).filter(p => p.severity === 'error')).toEqual([]);
    });
});

describe('folding the stage offset into the root', () => {
    test('an offset of nothing leaves the channels as they are', () => {
        const channels = [channel('root', 'POSITION', [key(0, [1, 2, 3])])];

        expect(foldStageOffset(channels, [{ bone: 'root', pivot: [0, 0, 0] }], none).channels).toBe(channels);
    });

    test('a turn of 90 degrees turns every position key about the origin and a move is added', () => {
        const folded = foldStageOffset([channel('root', 'POSITION', [key(0, [1, 0, 0]), key(1, [0, 5, 2])])], [{ bone: 'root', pivot: [0, 0, 0] }], { position: [10, 0, 0], yaw: 90 });
        const keys = folded.channels[0].keys;

        // (x, y, z) turned 90 degrees about +Y is (z, y, -x)
        expect(keys[0].value.literals[0]).toBeCloseTo(10, 6);
        expect(keys[0].value.literals[2]).toBeCloseTo(-1, 6);
        expect(keys[1].value.literals[0]).toBeCloseTo(12, 6);
        expect(keys[1].value.literals[1]).toBeCloseTo(5, 6);
        expect(keys[1].value.literals[2]).toBeCloseTo(0, 6);
        expect(folded.problems).toEqual([]);
    });

    test('a pivot away from the origin is turned about the stage origin, not about itself', () => {
        // a bone pivoted at (0,0,8) that does not move, turned 180 degrees about the stage origin, ends up pivoted at (0,0,-8): its position key is the difference
        const folded = foldStageOffset([channel('root', 'POSITION', [key(0, [0, 0, 0])])], [{ bone: 'root', pivot: [0, 0, 8] }], { position: [0, 0, 0], yaw: 180 });

        expect(folded.channels[0].keys[0].value.literals[2]).toBeCloseTo(-16, 6);
    });

    test('rotation keys are composed: a quarter turn after a quarter turn is a half turn', () => {
        const folded = foldStageOffset([channel('root', 'ROTATION', [key(0, [0, 90, 0]), key(1, [0, 170, 0])])], [{ bone: 'root', pivot: [0, 0, 0] }], { position: [0, 0, 0], yaw: 90 });
        const [first, second] = folded.channels[0].keys.map(k => k.value.literals);

        expect(first[1]).toBeCloseTo(180, 4);
        // 170 + 90 = 260, which is the same turn as -100 but not the long way round from 180
        expect(second[1]).toBeCloseTo(260, 4);
    });

    test('a root with no channels still stands where the stage puts it', () => {
        const folded = foldStageOffset([channel('arm', 'ROTATION', [key(0, [1, 2, 3])])], [{ bone: 'root', pivot: [0, 0, 0] }], { position: [10, 0, 0], yaw: 90 });
        const root = folded.channels.filter(c => c.target === 'root');

        expect(root.map(c => c.property).sort()).toEqual(['POSITION', 'ROTATION']);
        expect(root.find(c => c.property === 'POSITION')!.keys[0].value.literals).toEqual([10, 0, 0]);
        expect(root.find(c => c.property === 'ROTATION')!.keys[0].value.literals).toEqual([0, 90, 0]);
        expect(folded.channels.find(c => c.target === 'arm')!.keys[0].value.literals).toEqual([1, 2, 3]);
    });

    test('a Molang key cannot be folded: it is left alone and reported', () => {
        const expr = key(0, [0, 0, 0], { value: { literals: [0, 0, 0], expressions: ['math.sin(q.anim_time)', null, null] } });
        const folded = foldStageOffset([channel('root', 'POSITION', [expr])], [{ bone: 'root', pivot: [0, 0, 0] }], { position: [1, 0, 0], yaw: 0 });

        expect(folded.channels.find(c => c.property === 'POSITION')!.keys[0]).toBe(expr);
        expect(folded.problems[0]).toMatch(/Molang/);
    });

    test('the Euler angles of a turn come back out of the quaternion', () => {
        for (const euler of [[10, 20, 30], [-45, 80, 100], [0, 0, 0], [170, -30, -120]] as [number, number, number][]) {
            const again = qfromEulerDegrees(eulerOf(qfromEulerDegrees(euler)));
            const original = qfromEulerDegrees(euler);
            const same = again.every((v, i) => Math.abs(v - original[i]) < 1e-9) || again.every((v, i) => Math.abs(v + original[i]) < 1e-9);

            expect(same).toBe(true);
        }
    });
});

describe('exporting a workspace', () => {
    test('each actor gets a file in its own clip set, matched by its skeleton id, and a layout is written', () => {
        const { files, problems } = exportStage(stage());

        expect(problems.filter(p => p.severity === 'error')).toEqual([]);
        expect(files.map(f => f.path)).toEqual([
            'assets/mymod/strut/animations/scenes/doggy/host/skeletons/creature_a.strutanim',
            'assets/mymod/strut/animations/scenes/doggy/male/skeletons/human.strutanim',
            'assets/mymod/strut/scenes/doggy.strutscene',
        ]);

        const hostFile = decodeAnimation(files[0].bytes!, 'host');

        expect(hostFile.skeletonId).toBe('mymod:creature_a');
        expect(hostFile.clips).toHaveLength(1);
        expect(hostFile.clips[0]).toMatchObject({ name: 'animation.doggy.slow', duration: 1.5, loop: 'LOOP' });
        expect(hostFile.clips[0].channels[0].target).toBe('hips');
        expect(hostFile.clips[0].events[0]).toMatchObject({ time: 0.5, payload: 'mymod:thud' });
    });

    test('the male is shifted by his own offset in time and his stage offset is folded into his root', () => {
        const { files } = exportStage(stage());
        const clip = decodeAnimation(files[1].bytes!, 'male').clips[0];
        const position = clip.channels.find(c => c.target === 'root' && c.property === 'POSITION')!;
        const arm = clip.channels.find(c => c.target === 'arm')!;

        expect(arm.keys[0].time).toBeCloseTo(0.25, 6);
        expect(position.keys.map(k => k.time)).toEqual([0.25, 1.25]);
        // turned half a turn about the origin, then moved 10 along x: (0,0,0) -> (10,0,0) and (0,0,4) -> (10,0,-4)
        expect(position.keys[0].value.literals[0]).toBeCloseTo(10, 5);
        expect(position.keys[1].value.literals[2]).toBeCloseTo(-4, 5);
        expect(clip.channels.find(c => c.target === 'root' && c.property === 'ROTATION')!.keys[0].value.literals[1]).toBeCloseTo(180, 5);
    });

    test('the layout is what Strut reads: roles with clip sets and skeletons, clips in ticks', () => {
        const layout = JSON.parse(exportStage(stage()).files.find(f => f.path.endsWith('.strutscene'))!.text!);

        expect(layout).toEqual({
            roles: {
                host: { clipSet: 'scenes/doggy/host', skeleton: 'mymod:creature_a', compatible: ['mymod:creature_b'] },
                male: { clipSet: 'scenes/doggy/male', skeleton: 'mymod:human', required: false, camera: 'eye', lead: true },
            },
            clips: { 'animation.doggy.slow': { length: 30, loop: 'loop' } },
        });
    });

    test('a clips tags are written to the layout as authored', () => {
        const tagged = stage();
        const layout = JSON.parse(exportStage({ ...tagged, animations: [{ ...tagged.animations[0], phase: 'slow', variant: 2, side: 'L' }] }).files.find(f => f.path.endsWith('.strutscene'))!.text!);

        expect(layout.clips['animation.doggy.slow']).toEqual({ length: 30, loop: 'loop', phase: 'slow', variant: 2, side: 'L' });
    });

    test('a role exported for one model goes in that models character file', () => {
        const { files } = exportStage(stage(), { characters: { host: 'mymod:special' } });

        expect(files[0].path).toBe('assets/mymod/strut/animations/scenes/doggy/host/characters/special.strutanim');
        // still made for its skeleton, which the file names
        expect(decodeAnimation(files[0].bytes!, 'host').skeletonId).toBe('mymod:creature_a');
    });

    test('an error stops the export and no file is written', () => {
        const result = exportStage({ ...stage(), actors: [{ ...host, skeleton: '' }, male] });

        expect(result.files).toEqual([]);
        expect(result.problems.some(p => p.severity === 'error')).toBe(true);
    });

    test('a shift that moves a key before the start is put at 0 and said', () => {
        const moved = stage();
        const result = exportStage({ ...moved, animations: [{ ...moved.animations[0], tracks: { ...moved.animations[0].tracks, male: { ...moved.animations[0].tracks.male, shift: -1 } } }] });

        expect(result.problems.some(p => p.message.includes('before the start'))).toBe(true);
    });
});
