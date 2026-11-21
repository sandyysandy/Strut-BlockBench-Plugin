import { RawChannel, RawKey, RawValue } from '../binary/animation';
import { add, Q4, qaxisY, qfromEulerDegrees, qmul, qrotate, sub, V3 } from '../physics/math';
import { StageOffset, StageRoot } from './stageFormat';

/**
 * Folds an actor's stage offset into its root bone's keys
 * <p>
 * In game every role stands at the scene's origin and plays its clip there, so where an actor stands on the stage must be part of its clip. The offset is a rigid
 * move of the whole actor: turned about the vertical axis by {@code yaw} about the stage origin, then moved by {@code position}. A root bone transforms as
 * {@code T(pivot) T(pos) R S T(-pivot)}, so after the move it is the same with
 * <pre>
 *   R'   = Ry(yaw) R                                   (rotation keys are composed, not added)
 *   pos' = Ry(yaw) (pivot + pos) + offset - pivot
 * </pre>
 * The position fold is affine, so it is exact for every interpolation (a bezier's handles turn with the yaw and do not move with the offset). The rotation fold is
 * exact at every key; between two keys the composed angles are interpolated as the Euler angles they now are, which follows the same path as the originals when the
 * yaw is a multiple of 90 degrees and is an approximation otherwise (add keys where it matters)
 * <p>
 * Everything here is in <b>key space</b>: the space the keys are stored in. The rotation order is the game's ({@code Rz Ry Rx}). A workspace tool converts what the
 * editor's gizmo shows into key space once, when the offset is set; nothing here knows Blockbench
 */

export interface FoldResult {
    readonly channels: readonly RawChannel[];
    /** What could not be folded exactly; empty when everything was */
    readonly problems: readonly string[];
}

const ZERO: V3 = [0, 0, 0];

/** Whether the offset moves anything */
export function isIdentityOffset(offset: StageOffset): boolean {
    return offset.yaw === 0 && offset.position[0] === 0 && offset.position[1] === 0 && offset.position[2] === 0;
}

/**
 * Folds {@code offset} into the channels that drive {@code rootBone} (a group bone), adding a position or rotation channel when the actor had none and the offset
 * needs one. Channels of other bones are returned as they are
 */
export function foldStageOffset(channels: readonly RawChannel[], roots: readonly StageRoot[], offset: StageOffset): FoldResult {
    if (isIdentityOffset(offset))
        return { channels, problems: [] };

    const problems: string[] = [];
    const turn: Q4 = qaxisY(offset.yaw * Math.PI / 180);
    let result: RawChannel[] = [...channels];

    for (const root of roots)
        result = foldRoot(result, root, offset, turn, problems);

    return { channels: result, problems };
}

function foldRoot(channels: readonly RawChannel[], root: StageRoot, offset: StageOffset, turn: Q4, problems: string[]): RawChannel[] {
    const rootBone = root.bone;
    const pivot = root.pivot;
    const result: RawChannel[] = [];
    let hasPosition = false;
    let hasRotation = false;

    for (const channel of channels) {
        if (channel.target !== rootBone || channel.targetKind !== 'GROUP_BONE') {
            result.push(channel);

            continue;
        }

        if (channel.property === 'POSITION') {
            hasPosition = true;
            result.push({ ...channel, keys: channel.keys.map(key => foldPositionKey(key, pivot, offset, turn, problems, rootBone)) });
        }
        else if (channel.property === 'ROTATION') {
            hasRotation = true;
            result.push({ ...channel, keys: foldRotationKeys(channel.keys, turn, offset.yaw, problems, rootBone) });
        }
        else {
            result.push(channel);
        }
    }

    // an actor that never moved its root still has to stand where the stage puts it
    if (!hasPosition) {
        const at = foldPosition(ZERO, pivot, offset, turn);

        if (at[0] !== 0 || at[1] !== 0 || at[2] !== 0)
            result.push(constantChannel(rootBone, 'POSITION', at));
    }

    if (!hasRotation && offset.yaw !== 0)
        result.push(constantChannel(rootBone, 'ROTATION', [0, offset.yaw, 0]));

    return result;
}

function foldPosition(pos: V3, pivot: readonly [number, number, number], offset: StageOffset, turn: Q4): V3 {
    const pivotAt: V3 = [pivot[0], pivot[1], pivot[2]];

    return tidy(sub(add(qrotate(turn, add(pivotAt, pos)), [offset.position[0], offset.position[1], offset.position[2]]), pivotAt));
}

/** Rounds away the 1e-15 left by turning a vector, so a clip does not hold 1.2e-15 where it means 0 */
function tidy(v: V3): V3 {
    return v.map(c => Math.round(c * 1e9) / 1e9 + 0) as V3;
}

function constantChannel(target: string, property: 'POSITION' | 'ROTATION', value: V3): RawChannel {
    return {
        target, targetKind: 'GROUP_BONE', property, interpolation: 'LINEAR',
        keys: [{ time: 0, interpolation: 'LINEAR', value: { literals: value, expressions: [null, null, null] }, post: null, easing: null, easingArgs: [], bezier: null }],
    };
}

function hasExpression(value: RawValue): boolean {
    return value.expressions.some(expression => expression !== null);
}

function foldPositionKey(key: RawKey, pivot: readonly [number, number, number], offset: StageOffset, turn: Q4, problems: string[], bone: string): RawKey {
    if (hasExpression(key.value) || key.post !== null && hasExpression(key.post)) {
        problems.push(`${bone} has a position key at ${key.time}s that is a Molang expression; the stage offset cannot be folded into it, so it is left as it is`);

        return key;
    }

    const at = (value: RawValue): RawValue => ({ literals: foldPosition(value.literals as V3, pivot, offset, turn), expressions: value.expressions });
    const bezier = key.bezier === null ? null : {
        leftTime: key.bezier.leftTime,
        leftValue: qrotate(turn, key.bezier.leftValue),
        rightTime: key.bezier.rightTime,
        rightValue: qrotate(turn, key.bezier.rightValue),
    };

    return { ...key, value: at(key.value), post: key.post === null ? null : at(key.post), bezier };
}

function foldRotationKeys(keys: readonly RawKey[], turn: Q4, yaw: number, problems: string[], bone: string): RawKey[] {
    if (yaw === 0)
        return [...keys];

    const folded: RawKey[] = [];
    let previous: V3 | null = null;

    for (const key of keys) {
        if (hasExpression(key.value) || key.post !== null && hasExpression(key.post)) {
            problems.push(`${bone} has a rotation key at ${key.time}s that is a Molang expression; the stage turn cannot be folded into it, so it is left as it is`);
            folded.push(key);

            continue;
        }

        if (key.bezier !== null)
            problems.push(`${bone} has a bezier rotation key at ${key.time}s; its handles are not turned with the stage, so check the curve`);

        const literals = key.value.literals as V3;
        // the first key is put near the plain sum (a turn about y added to the angle about y), which is the answer when only y is turned: no needless 180s about x and z
        const value = composeRotation(turn, literals, previous ?? [literals[0], literals[1] + yaw, literals[2]]);

        previous = value;

        const post = key.post === null ? null : { literals: composeRotation(turn, key.post.literals as V3, value), expressions: key.post.expressions };

        folded.push({ ...key, value: { literals: value, expressions: key.value.expressions }, post });
    }

    return folded;
}

/** {@code turn} then the Euler rotation {@code euler}, as Euler angles near {@code near} (so a run of keys does not spin the long way round) */
function composeRotation(turn: Q4, euler: V3, near: V3): V3 {
    return closest(eulerOf(qmul(turn, qfromEulerDegrees(euler))), near);
}

/** The Euler angles (degrees, applied z then y then x) of a unit quaternion */
export function eulerOf(q: Q4): V3 {
    const [x, y, z, w] = q;
    // the matrix elements of Rz Ry Rx
    const m20 = 2 * (x * z - w * y);
    const m21 = 2 * (y * z + w * x);
    const m22 = 1 - 2 * (x * x + y * y);
    const m10 = 2 * (x * y + w * z);
    const m00 = 1 - 2 * (y * y + z * z);
    const m11 = 1 - 2 * (x * x + z * z);
    const m12 = 2 * (y * z - w * x);
    const degrees = 180 / Math.PI;

    if (Math.abs(m20) > 0.9999999) {
        // looking straight up or down: x and z are one turn; give it all to x
        return [Math.atan2(-m12, m11) * degrees, (m20 < 0 ? 90 : -90), 0];
    }

    return [Math.atan2(m21, m22) * degrees, Math.asin(-m20) * degrees, Math.atan2(m10, m00) * degrees];
}

/** Of the Euler triples that are the same turn (each angle plus whole turns, and the other way to reach the same pose), the one nearest {@code near} */
function closest(euler: V3, near: V3): V3 {
    const candidates: V3[] = [euler, [euler[0] + 180, 180 - euler[1], euler[2] + 180]];
    let best: V3 = euler;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const unwrapped = candidate.map((angle, i) => angle + 360 * Math.round((near[i] - angle) / 360)) as V3;
        const distance = Math.abs(unwrapped[0] - near[0]) + Math.abs(unwrapped[1] - near[1]) + Math.abs(unwrapped[2] - near[2]);

        if (distance < bestDistance) {
            bestDistance = distance;
            best = unwrapped;
        }
    }

    return best;
}
