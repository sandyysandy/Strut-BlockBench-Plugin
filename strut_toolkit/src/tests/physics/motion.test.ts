import { defaultMotionOptions, MOTION_DEFS, motionAt } from '../../ts/physics/motion';

describe('the test moves', () => {
    it('give a finite place and turn at every time, for every move, at the default settings and at the ends of each setting', () => {
        for (const def of MOTION_DEFS) {
            const sets = [{}, ...def.options.flatMap(o => [{ [o.id]: o.min }, { [o.id]: o.max }])];

            for (const set of sets) {
                for (let t = 0; t < 12; t += 0.07) {
                    const m = motionAt(def.id, t, set);

                    expect([...m.pos, m.yaw].every(Number.isFinite)).toBe(true);
                }
            }
        }
    });

    it('keep the old moves exactly as they were at their default settings', () => {
        expect(motionAt('walk', 0.5)).toEqual({ pos: [0, 0, 1.4 * Math.sin(0.5 * 1.3)], yaw: 0 });
        expect(motionAt('turn', 0.5).yaw).toBeCloseTo(0.9 * Math.sin(0.5 * 2.4), 2);
        expect(motionAt('spin', 2).yaw).toBeCloseTo(6.4, 9);
        expect(motionAt('jump', 0.3).pos[1]).toBeCloseTo(0.9 * Math.sin(1.5), 9);
        expect(motionAt('run', 1).pos[2]).toBeCloseTo(1.6 * 0.4, 9);
    });

    it('go the way each setting says', () => {
        expect(Math.abs(motionAt('walk', 0.8, { axis: 1 }).pos[0])).toBeGreaterThan(0);
        expect(motionAt('walk', 0.8, { axis: 1 }).pos[2]).toBe(0);
        expect(motionAt('walk', 0.8, { distance: 2.8 }).pos[2]).toBeCloseTo(2 * motionAt('walk', 0.8).pos[2], 9);
        expect(motionAt('spin', 1, { direction: -1 }).yaw).toBeLessThan(0);
        expect(motionAt('jump', 1, { drift: 2 }).pos[2]).toBeCloseTo(2, 9);
        expect(motionAt('crouch', Math.PI / 1.2, { depth: 0.8 }).pos[1]).toBeCloseTo(-0.8, 6);
    });

    it('face the way it goes when asked: a circle turns round once as it goes round once', () => {
        const turn = (t: number): number => motionAt('circle', t, { facing: 1, pace: 1 }).yaw;

        expect(motionAt('circle', 1, { facing: 0 }).yaw).toBe(0);
        // the heading of a path that goes right round changes by a whole turn
        expect(Math.abs(turn(0.001) - turn(2 * Math.PI - 0.001))).toBeCloseTo(0, 1);
        expect(Math.abs(turn(Math.PI / 2) - turn(0))).toBeCloseTo(Math.PI / 2, 1);
    });

    it('start and stop with a hold between, and a shove that settles', () => {
        const stutter = { distance: 1, travel: 0.5, hold: 1 };

        expect(motionAt('stutter', 0.75, stutter).pos[2]).toBeCloseTo(1, 9);
        expect(motionAt('stutter', 1.2, stutter).pos[2]).toBeCloseTo(1, 9);
        expect(motionAt('stutter', 3, stutter).pos[2]).toBeCloseTo(0, 9);
        expect(motionAt('knock', 0.08, { distance: 1 }).pos[2]).toBeCloseTo(1, 6);
        expect(motionAt('knock', 1.4, { distance: 1 }).pos[2]).toBeLessThan(0.1);
    });

    it('have a default for every setting', () => {
        const all = defaultMotionOptions();

        for (const def of MOTION_DEFS) expect(Object.keys(all[def.id])).toEqual(def.options.map(o => o.id));
    });
});
