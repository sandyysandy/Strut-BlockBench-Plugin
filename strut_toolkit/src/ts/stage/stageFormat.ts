import { LoopMode, LoopModeName, RawChannel, RawEvent } from '../binary/animation';
import { isValidSkeletonId } from '../binary/skeletonId';

/**
 * The workspace file ({@code .strutstage}): a scene, or one skeleton's clips, authored on one timeline for every actor, separated per actor only when exported
 * <p>
 * Plain data, no Blockbench: the tracks are kept by actor and bone name (never by group UUID), in the same shape the binary animation format holds them, so a
 * workspace does not depend on any one model and swapping an actor's preview model loses no keyframe. JSON on disk
 */

export const STAGE_FORMAT = 'strut_stage';
export const STAGE_VERSION = 1;
export const STAGE_EXTENSION = 'strutstage';

/** Where an actor stands on the stage, in the space the keys of its root bone are stored in (see {@link foldStageOffset}) */
export interface StageOffset {
    readonly position: readonly [number, number, number];
    /** Degrees about the vertical axis */
    readonly yaw: number;
}

export interface StageRoot {
    readonly bone: string;
    readonly pivot: readonly [number, number, number];
}

export interface StageActor {
    /** The scene role this actor is exported as ({@code host}, {@code male}, {@code third}), unique in the workspace */
    readonly role: string;
    /** The skeleton id it is animated for; its preview model must have this id */
    readonly skeleton: string;
    /** The preview model, by the model's id or file: a hint for reloading, never read by the game. Swappable at any time */
    readonly model?: string;
    /** The bones the stage offset is folded into on export: the preview model's top level bones, each with its pivot (a turn about the stage origin moves a bone whose pivot is not there) */
    readonly roots: readonly StageRoot[];
    readonly offset: StageOffset;
    /** Other skeleton ids that may fill the role, written to the layout */
    readonly compatible?: readonly string[];
    /** Whether the scene cannot start without the role (default true) */
    readonly required?: boolean;
    /** The bone a player in this role looks out of */
    readonly camera?: string;
    /** Whether this is the scene's lead role */
    readonly lead?: boolean;
}

/** What one actor does in one animation */
export interface StageTrack {
    readonly channels: readonly RawChannel[];
    readonly events: readonly RawEvent[];
    /** Seconds this actor's keys and events are moved later (or earlier, if negative) against the others when exported: a reaction a few frames behind */
    readonly shift?: number;
}

/** One clip of the whole workspace: every actor's tracks on one clock. Its name is the clip name every actor is exported under */
export interface StageAnimation {
    readonly name: string;
    /** Seconds; one for every actor */
    readonly duration: number;
    readonly loop: LoopModeName;
    /** A mod's own tags for the layout, written as authored and never worked out from the name: what part of the scene it is, which of several (from 1), which way */
    readonly phase?: string;
    readonly variant?: number;
    readonly side?: string;
    /** By role */
    readonly tracks: Readonly<Record<string, StageTrack>>;
}

export interface Stage {
    readonly format: typeof STAGE_FORMAT;
    readonly version: number;
    /** The scene's path ({@code tango}), which names its layout and its clip sets */
    readonly scene: string;
    /** The namespace the scene layout is written under */
    readonly namespace: string;
    readonly actors: readonly StageActor[];
    readonly animations: readonly StageAnimation[];
}

export function newStage(scene: string, namespace: string): Stage {
    return { format: STAGE_FORMAT, version: STAGE_VERSION, scene, namespace, actors: [], animations: [] };
}

export function serializeStage(stage: Stage): string {
    return JSON.stringify(stage, null, 2);
}

const PATH = /^[a-z0-9_./-]+$/;
const NAMESPACE = /^[a-z0-9_.-]+$/;

/** Reads a workspace file; throws an Error naming what is wrong with it, so a damaged file is never half loaded */
export function parseStage(text: string): Stage {
    let root: any;

    try {
        root = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`the workspace is not valid JSON: ${(error as Error).message}`);
    }

    if (typeof root !== 'object' || root === null || root.format !== STAGE_FORMAT)
        throw new Error(`this is not a Strut workspace (its format is not "${STAGE_FORMAT}")`);

    if (typeof root.version !== 'number' || root.version > STAGE_VERSION)
        throw new Error(`this workspace is version ${root.version}, which is newer than this build reads (${STAGE_VERSION}); update the plugin`);

    if (typeof root.scene !== 'string' || !PATH.test(root.scene))
        throw new Error('the workspace has no valid scene path');

    if (typeof root.namespace !== 'string' || !NAMESPACE.test(root.namespace))
        throw new Error('the workspace has no valid namespace');

    if (!Array.isArray(root.actors) || !Array.isArray(root.animations))
        throw new Error('the workspace has no actors or animations list');

    const roles = new Set<string>();

    for (const actor of root.actors) {
        if (typeof actor?.role !== 'string' || actor.role === '' || !PATH.test(actor.role))
            throw new Error('an actor has no valid role name');

        if (roles.has(actor.role))
            throw new Error(`two actors are the role "${actor.role}"`);

        roles.add(actor.role);

        if (typeof actor.skeleton !== 'string')
            throw new Error(`the actor "${actor.role}" has no skeleton id`);

        if (!Array.isArray(actor.roots) || actor.roots.some((root: any) => typeof root?.bone !== 'string' || !Array.isArray(root.pivot) || root.pivot.length !== 3))
            throw new Error(`the actor "${actor.role}" has no root bones with pivots`);

        if (typeof actor.offset?.yaw !== 'number' || !Array.isArray(actor.offset.position) || actor.offset.position.length !== 3)
            throw new Error(`the actor "${actor.role}" has no stage offset`);
    }

    const names = new Set<string>();

    for (const animation of root.animations) {
        if (typeof animation?.name !== 'string' || animation.name === '')
            throw new Error('an animation has no name');

        if (names.has(animation.name))
            throw new Error(`two animations are named "${animation.name}"`);

        names.add(animation.name);

        if (typeof animation.duration !== 'number' || !(animation.duration >= 0))
            throw new Error(`the animation "${animation.name}" has no valid length`);

        if (!(animation.loop in LoopMode))
            throw new Error(`the animation "${animation.name}" has the loop mode "${animation.loop}"`);

        for (const role of Object.keys(animation.tracks ?? {})) {
            if (!roles.has(role))
                throw new Error(`the animation "${animation.name}" has a track for "${role}", who is not an actor`);
        }
    }

    return root as Stage;
}

export type Severity = 'error' | 'warning';

export interface Problem {
    readonly severity: Severity;
    readonly message: string;
}

/**
 * What is wrong with a workspace for export, the checks of the plan's section 4d. Errors stop an export; warnings are shown. A scene cannot check a role that has
 * no skeleton id, and every actor is one clip on one clock, so the checks are about those
 */
export function checkStage(stage: Stage): Problem[] {
    const problems: Problem[] = [];
    const error = (message: string): void => void problems.push({ severity: 'error', message });
    const warn = (message: string): void => void problems.push({ severity: 'warning', message });

    if (stage.actors.length === 0)
        error('the workspace has no actors');

    for (const actor of stage.actors) {
        if (actor.skeleton === '')
            error(`${actor.role} has no skeleton id, so a scene could not check who fills the role`);
        else if (!isValidSkeletonId(actor.skeleton))
            error(`${actor.role}: "${actor.skeleton}" is not a skeleton id (a namespace, a colon and a path, such as mymod:creature)`);

        for (const other of actor.compatible ?? []) {
            if (!isValidSkeletonId(other))
                error(`${actor.role}: the compatible skeleton "${other}" is not a skeleton id`);
        }
    }

    if (stage.actors.filter(actor => actor.lead).length > 1)
        warn('more than one role is the lead; the first is used');

    for (const animation of stage.animations) {
        if (animation.duration <= 0)
            error(`the animation "${animation.name}" has no length`);

        for (const actor of stage.actors) {
            const track = animation.tracks[actor.role];

            if (!track || track.channels.length === 0 && track.events.length === 0)
                warn(`${actor.role} does nothing in "${animation.name}"; it is exported as an empty clip, so the role stands at rest`);

            for (const channel of track?.channels ?? []) {
                const last = channel.keys.length === 0 ? 0 : channel.keys[channel.keys.length - 1].time + (track?.shift ?? 0);

                if (last > animation.duration + 1e-6)
                    warn(`${actor.role} has a key at ${last.toFixed(3)}s in "${animation.name}", after its end at ${animation.duration}s`);
            }
        }
    }

    return problems;
}
