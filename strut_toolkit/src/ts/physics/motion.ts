/** The scripted movements the model is put through in the preview, and the line drawings of colliders. Pure maths; no Blockbench globals */
import { add, cross, normalize, qfromEulerDegrees, qmul, qrotate, scale, V3 } from './math';
import { BoneFrame } from './rig';
import { ColliderSpec } from './autoColliders';

export type MotionKind = 'idle' | 'walk' | 'run' | 'turn' | 'spin' | 'jump' | 'hop' | 'crouch' | 'shake' | 'circle' | 'eight' | 'stutter' | 'knock' | 'dance';

/** One setting of a move: a number with a range, or a choice among a few ({@code choices}) */
export interface MotionOption {
    readonly id: string;
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly value: number;
    readonly hint: string;
    readonly unit?: string;
    readonly choices?: readonly { readonly id: number; readonly label: string }[];
}

export interface MotionDef { readonly id: MotionKind; readonly label: string; readonly help: string; readonly options: readonly MotionOption[] }

/** The directions a move may go in, for the moves that go along a line */
const AXIS: MotionOption['choices'] = [{ id: 0, label: 'Forward' }, { id: 1, label: 'Sideways' }, { id: 2, label: 'Up' }];
const FACING: MotionOption['choices'] = [{ id: 0, label: 'No' }, { id: 1, label: 'Yes' }];

const axisOption = (hint = 'Which way it goes: forward and back, sideways, or up and down.'): MotionOption => ({ id: 'axis', label: 'Direction', min: 0, max: 2, step: 1, value: 0, hint, choices: AXIS });
const facingOption = (hint: string): MotionOption => ({ id: 'facing', label: 'Faces the way it goes', min: 0, max: 1, step: 1, value: 0, hint, choices: FACING });

export const MOTION_DEFS: readonly MotionDef[] = [
    { id: 'idle', label: 'Stand still', help: 'No move: only an animation, if one is chosen.', options: [] },
    {
        id: 'walk', label: 'Walk back and forth', help: 'Walks to one side and back, at a steady pace.', options: [
            { id: 'distance', label: 'Distance', min: 0.1, max: 4, step: 0.05, value: 1.4, unit: 'blocks', hint: 'How far it goes each way.' },
            { id: 'pace', label: 'Pace', min: 0.2, max: 5, step: 0.05, value: 1.3, hint: 'How quickly it goes back and forth.' },
            axisOption(),
            facingOption('Turns to face where it is walking, and turns round at each end.'),
        ],
    },
    {
        id: 'run', label: 'Run and stop', help: 'Speeds up, coasts, stops hard, stands, then goes back.', options: [
            { id: 'distance', label: 'Distance', min: 0.5, max: 8, step: 0.1, value: 3.36, unit: 'blocks', hint: 'How far the run goes.' },
            { id: 'cycle', label: 'Cycle', min: 1.5, max: 10, step: 0.1, value: 4, unit: 's', hint: 'How long one run, stop and return takes. Shorter is a harder stop.' },
            axisOption(),
        ],
    },
    {
        id: 'turn', label: 'Turn side to side', help: 'Turns on the spot to one side and back.', options: [
            { id: 'angle', label: 'Angle', min: 5, max: 180, step: 1, value: 51.5, unit: '°', hint: 'How far it turns each way.' },
            { id: 'pace', label: 'Pace', min: 0.3, max: 8, step: 0.1, value: 2.4, hint: 'How quickly it turns back and forth.' },
        ],
    },
    {
        id: 'spin', label: 'Spin', help: 'Turns round and round.', options: [
            { id: 'rate', label: 'Spin speed', min: 0.3, max: 14, step: 0.1, value: 3.2, unit: 'rad/s', hint: 'How fast it turns: 6.28 is one turn a second.' },
            { id: 'direction', label: 'Turns', min: -1, max: 1, step: 2, value: 1, hint: 'Which way round.', choices: [{ id: 1, label: 'One way' }, { id: -1, label: 'The other' }] },
        ],
    },
    {
        id: 'jump', label: 'Jump', help: 'Jumps up and lands, again and again.', options: [
            { id: 'height', label: 'Height', min: 0.1, max: 3, step: 0.05, value: 0.9, unit: 'blocks', hint: 'How high it goes.' },
            { id: 'pace', label: 'Pace', min: 1, max: 12, step: 0.1, value: 5, hint: 'How quickly it jumps again.' },
            { id: 'drift', label: 'Travels', min: -2, max: 2, step: 0.05, value: 0, unit: 'blocks/s', hint: 'How fast it goes forward while it jumps (a negative number goes back).' },
        ],
    },
    {
        id: 'hop', label: 'Bounce', help: 'Small quick bounces, like a jog on the spot.', options: [
            { id: 'height', label: 'Height', min: 0.02, max: 0.6, step: 0.01, value: 0.15, unit: 'blocks', hint: 'How high each bounce goes.' },
            { id: 'pace', label: 'Pace', min: 2, max: 24, step: 0.5, value: 8, hint: 'How quickly it bounces.' },
        ],
    },
    {
        id: 'crouch', label: 'Crouch and rise', help: 'Drops down and comes back up.', options: [
            { id: 'depth', label: 'Depth', min: 0.05, max: 1.2, step: 0.05, value: 0.5, unit: 'blocks', hint: 'How far it drops.' },
            { id: 'pace', label: 'Pace', min: 0.2, max: 6, step: 0.1, value: 1.2, hint: 'How quickly it goes down and up.' },
        ],
    },
    {
        id: 'shake', label: 'Shake', help: 'A quick small shake along a line, to see how it holds on.', options: [
            { id: 'amount', label: 'Amount', min: 0.01, max: 0.4, step: 0.01, value: 0.08, unit: 'blocks', hint: 'How far each shake goes.' },
            { id: 'pace', label: 'Pace', min: 4, max: 60, step: 1, value: 25, hint: 'How quickly it shakes.' },
            axisOption(),
        ],
    },
    {
        id: 'circle', label: 'Walk in a circle', help: 'Walks round a circle.', options: [
            { id: 'radius', label: 'Radius', min: 0.2, max: 4, step: 0.05, value: 1.2, unit: 'blocks', hint: 'How wide the circle is.' },
            { id: 'pace', label: 'Pace', min: 0.2, max: 4, step: 0.05, value: 0.8, hint: 'How quickly it goes round.' },
            facingOption('Turns along the circle, as someone walking it would.'),
        ],
    },
    {
        id: 'eight', label: 'Figure of eight', help: 'Walks a figure of eight, so it speeds up, slows and turns both ways.', options: [
            { id: 'size', label: 'Size', min: 0.2, max: 4, step: 0.05, value: 1, unit: 'blocks', hint: 'How wide the eight is.' },
            { id: 'pace', label: 'Pace', min: 0.2, max: 4, step: 0.05, value: 0.9, hint: 'How quickly it walks it.' },
            facingOption('Turns along the path, as someone walking it would.'),
        ],
    },
    {
        id: 'stutter', label: 'Start and stop', help: 'Moves off, stops dead, waits, and moves back: sudden starts and stops.', options: [
            { id: 'distance', label: 'Distance', min: 0.1, max: 4, step: 0.05, value: 1.2, unit: 'blocks', hint: 'How far it goes each time.' },
            { id: 'travel', label: 'Time to go', min: 0.1, max: 3, step: 0.05, value: 0.6, unit: 's', hint: 'How long each move takes. Shorter is a harder start and stop.' },
            { id: 'hold', label: 'Time standing', min: 0, max: 3, step: 0.05, value: 0.5, unit: 's', hint: 'How long it stands between moves.' },
            axisOption(),
        ],
    },
    {
        id: 'knock', label: 'Knock', help: 'Is shoved suddenly and settles back, again and again.', options: [
            { id: 'distance', label: 'Shove', min: 0.05, max: 2, step: 0.05, value: 0.8, unit: 'blocks', hint: 'How far it is shoved.' },
            { id: 'every', label: 'Every', min: 0.5, max: 6, step: 0.1, value: 1.5, unit: 's', hint: 'How long between shoves.' },
            { id: 'settle', label: 'Settles in', min: 0.1, max: 3, step: 0.05, value: 0.6, unit: 's', hint: 'How quickly it comes back.' },
            axisOption(),
        ],
    },
    {
        id: 'dance', label: 'Dance', help: 'A bounce, a sway and a turn together.', options: [
            { id: 'bounce', label: 'Bounce', min: 0, max: 0.5, step: 0.01, value: 0.12, unit: 'blocks', hint: 'How high it bounces.' },
            { id: 'sway', label: 'Sway', min: 0, max: 1.5, step: 0.05, value: 0.4, unit: 'blocks', hint: 'How far it sways side to side.' },
            { id: 'turn', label: 'Turn', min: 0, max: 90, step: 1, value: 25, unit: '°', hint: 'How far it turns each way.' },
            { id: 'pace', label: 'Pace', min: 0.5, max: 8, step: 0.1, value: 2.5, hint: 'How quickly it dances.' },
        ],
    },
];

/** The moves as a list for a menu */
export const MOTIONS: { id: MotionKind; label: string }[] = MOTION_DEFS.map(d => ({ id: d.id, label: d.label }));

export type MotionOptions = Record<string, number>;

/** The settings of every move, at their defaults */
export function defaultMotionOptions(): Record<string, MotionOptions> {
    return Object.fromEntries(MOTION_DEFS.map(d => [d.id, Object.fromEntries(d.options.map(o => [o.id, o.value]))]));
}

export interface Motion { readonly pos: V3; readonly yaw: number }

const smooth = (x: number): number => {
    const c = Math.max(0, Math.min(1, x));

    return c * c * (3 - 2 * c);
};

/** A point on a line along {@code axis} (0 forward, 1 sideways, 2 up), as a position */
function along(axis: number, v: number): V3 {
    return axis === 1 ? [v, 0, 0] : axis === 2 ? [0, v, 0] : [0, 0, v];
}

/** The turn that faces something going in the direction (x, z): 0 is facing forward (+z) */
const heading = (x: number, z: number): number => Math.atan2(x, z);

/** Where the model is at {@code t} seconds, blocks and radians; {@code options} are the move's settings (what is missing is the default) */
export function motionAt(kind: MotionKind, t: number, options: Partial<MotionOptions> = {}): Motion {
    const def = MOTION_DEFS.find(d => d.id === kind);
    const o = (id: string): number => options[id] ?? def?.options.find(x => x.id === id)?.value ?? 0;

    switch (kind) {
        case 'walk': {
            const a = t * o('pace');
            const v = o('distance') * Math.sin(a);
            const axis = o('axis');
            let yaw = 0;

            if (o('facing') >= 0.5) {
                // the way it goes is the sign of its speed, and it turns round smoothly at the ends
                const h = Math.tanh(6 * Math.cos(a));

                yaw = axis === 1 ? h * Math.PI / 2 : (1 - h) / 2 * Math.PI;
            }

            return { pos: along(axis, v), yaw };
        }
        case 'run': {
            // speed up for 3/8 of the cycle, coast for a quarter, stop hard, stand, then back to the start
            const cycle = o('cycle');
            const c = (t % cycle) * 4 / cycle;
            const d = c < 1.5 ? 1.6 * c * c : c < 2.5 ? 3.6 + 4.8 * (c - 1.5) : 8.4;
            const back = c > 3 ? (c - 3) * 8.4 : 0;

            return { pos: along(o('axis'), (d - back) * o('distance') / 8.4), yaw: 0 };
        }
        case 'turn':
            return { pos: [0, 0, 0], yaw: o('angle') * Math.PI / 180 * Math.sin(t * o('pace')) };
        case 'spin':
            return { pos: [0, 0, 0], yaw: t * o('rate') * (o('direction') < 0 ? -1 : 1) };
        case 'jump':
            return { pos: [0, Math.max(0, o('height') * Math.sin(t * o('pace'))), t * o('drift')], yaw: 0 };
        case 'hop':
            return { pos: [0, o('height') * Math.abs(Math.sin(t * o('pace') / 2)), 0], yaw: 0 };
        case 'crouch':
            return { pos: [0, -o('depth') * (0.5 - 0.5 * Math.cos(t * o('pace'))), 0], yaw: 0 };
        case 'shake':
            return { pos: along(o('axis'), o('amount') * Math.sin(t * o('pace'))), yaw: 0 };
        case 'circle': {
            const a = t * o('pace');
            const r = o('radius');

            // round a circle that starts at the origin; the way it goes is the slope of the path
            return { pos: [r * Math.sin(a), 0, r * (Math.cos(a) - 1)], yaw: o('facing') >= 0.5 ? heading(Math.cos(a), -Math.sin(a)) : 0 };
        }
        case 'eight': {
            const a = t * o('pace');
            const s = o('size');

            return { pos: [s * Math.sin(a), 0, s * Math.sin(2 * a) / 2], yaw: o('facing') >= 0.5 ? heading(Math.cos(a), Math.cos(2 * a)) : 0 };
        }
        case 'stutter': {
            const go = Math.max(0.05, o('travel'));
            const hold = o('hold');
            const c = t % (2 * (go + hold));
            const s = c < go ? smooth(c / go) : c < go + hold ? 1 : c < 2 * go + hold ? 1 - smooth((c - go - hold) / go) : 0;

            return { pos: along(o('axis'), o('distance') * s), yaw: 0 };
        }
        case 'knock': {
            const c = t % o('every');
            const rise = 0.08;
            const s = c < rise ? smooth(c / rise) : Math.exp(-(c - rise) * 3 / Math.max(0.05, o('settle')));

            return { pos: along(o('axis'), o('distance') * s), yaw: 0 };
        }
        case 'dance': {
            const a = t * o('pace');

            return { pos: [o('sway') * Math.sin(a / 2), o('bounce') * Math.abs(Math.sin(a)), 0], yaw: o('turn') * Math.PI / 180 * Math.sin(a / 2 + 1) };
        }
        default:
            return { pos: [0, 0, 0], yaw: 0 };
    }
}

// ---------------- collider drawings ----------------

export type Segment = readonly [V3, V3];

function ring(centre: V3, u: V3, v: V3, r: number, n = 16): Segment[] {
    const out: Segment[] = [];
    const point = (i: number): V3 => add(centre, add(scale(u, Math.cos(i / n * 2 * Math.PI) * r), scale(v, Math.sin(i / n * 2 * Math.PI) * r)));

    for (let i = 0; i < n; i++) out.push([point(i), point(i + 1)]);

    return out;
}

/** The lines that outline a collider on its bone, in world blocks */
export function colliderLines(spec: ColliderSpec, frame: BoneFrame): Segment[] {
    const at = (local: V3): V3 => add(frame.origin, qrotate(frame.orientation, scale(local, 1 / 16)));
    const axis = (i: number): V3 => qrotate(frame.orientation, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]);
    const lines: Segment[] = [];

    if (spec.shape === 'box') {
        const turn = spec.rotation ? qmul(frame.orientation, qfromEulerDegrees(spec.rotation)) : frame.orientation;
        const axis = (i: number): V3 => qrotate(turn, [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]);
        const c = at(spec.a);
        const h = [spec.b[0] / 32, spec.b[1] / 32, spec.b[2] / 32];
        const corner = (sx: number, sy: number, sz: number): V3 => add(c, add(add(scale(axis(0), sx * h[0]), scale(axis(1), sy * h[1])), scale(axis(2), sz * h[2])));

        for (const [a, b] of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
            const p = (i: number): V3 => corner(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1);

            lines.push([p(a), p(b)]);
        }

        return lines;
    }

    const r = spec.radius / 16;

    if (spec.shape === 'sphere') {
        const c = at(spec.a);

        return [...ring(c, axis(0), axis(1), r), ...ring(c, axis(1), axis(2), r), ...ring(c, axis(0), axis(2), r)];
    }

    const a = at(spec.a);
    const b = at(spec.b);
    const dir = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const u = normalize(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = cross(dir, u);

    lines.push(...ring(a, u, w, r), ...ring(b, u, w, r));

    for (const s of [u, w, scale(u, -1), scale(w, -1)]) lines.push([add(a, scale(s, r)), add(b, scale(s, r))]);

    return lines;
}

// ---------------- angle limits ----------------

/** The arc a spring bone's lever tip can sweep about one of its own axes between two angles (degrees), from the bone's pivot, in world blocks */
export function limitArc(frame: BoneFrame, lever: V3, axis: 0 | 1 | 2, minDeg: number, maxDeg: number, steps = 20): Segment[] {
    const out: Segment[] = [];
    const point = (deg: number): V3 => {
        const r: V3 = [0, 0, 0];

        r[axis] = deg;

        return add(frame.origin, qrotate(frame.orientation, qrotate(qfromEulerDegrees(r), lever)));
    };

    for (let i = 0; i < steps; i++) {
        const a = minDeg + (maxDeg - minDeg) * i / steps;
        const b = minDeg + (maxDeg - minDeg) * (i + 1) / steps;

        out.push([point(a), point(b)]);
    }

    out.push([frame.origin, point(minDeg)], [frame.origin, point(maxDeg)]);

    return out;
}

/** The cone a chain segment may swing within: {@code maxAngle} degrees about the direction from {@code a} to {@code b}, as a ring and four spokes */
export function limitCone(a: V3, b: V3, maxDeg: number, n = 20): Segment[] {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as V3;
    const len = Math.hypot(d[0], d[1], d[2]);

    if (len < 1e-9 || maxDeg <= 0) return [];

    const dir = normalize(d);
    const u = normalize(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = cross(dir, u);
    const angle = Math.min(maxDeg, 179) * Math.PI / 180;
    const centre = add(a, scale(dir, Math.cos(angle) * len));
    const r = Math.sin(angle) * len;
    const out: Segment[] = ring(centre, u, w, r, n);

    for (const s of [u, w, scale(u, -1), scale(w, -1)]) out.push([a, add(centre, scale(s, r))]);

    return out;
}
