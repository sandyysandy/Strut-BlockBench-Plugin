import { encodeAnimation, LoopModeName, RawBinaryAnimation, RawChannel, RawClip, RawEvent, RawKey, RawValue, ANIMATION_VERSION } from '../binary/animation';
import { StringTable } from '../binary/writer';
import { foldStageOffset } from './stageFold';
import { checkStage, Problem, Stage, StageActor, StageAnimation } from './stageFormat';

/**
 * Exports a workspace: each actor's tracks become that actor's own clips, in a file made for its skeleton id (or for one model, if the author says so), and the
 * scene's layout is written beside them. Pure: it returns the files, the caller writes them (into a pack folder, or through Blockbench's save dialog)
 * <p>
 * For one actor and one animation the clip is the actor's track with its time shift applied and its stage offset folded into its root bone ({@link
 * foldStageOffset}). Every actor's clip has the animation's name, length and loop mode, because in game it is one clip on one clock
 */

export interface ExportedFile {
    /** From the root of the pack, such as {@code assets/mymod/strut/animations/scenes/doggy/host/skeletons/creature.strutanim} */
    readonly path: string;
    readonly bytes?: Uint8Array;
    readonly text?: string;
}

export interface ExportOptions {
    /**
     * By role: the model id ({@code mymod:creature_a}, the character a mod declares) whose own file the role's clips go into, instead of the skeleton's. A role that is not
     * listed is exported for its skeleton
     */
    readonly characters?: Readonly<Record<string, string>>;
}

export interface ExportResult {
    readonly files: readonly ExportedFile[];
    /** Errors stop the export (then there are no files); warnings come with the files */
    readonly problems: readonly Problem[];
}

const TICKS_PER_SECOND = 20;

export function exportStage(stage: Stage, options: ExportOptions = {}): ExportResult {
    const problems: Problem[] = checkStage(stage);

    for (const actor of stage.actors) {
        const character = options.characters?.[actor.role];

        if (character !== undefined && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(character))
            problems.push({ severity: 'error', message: `${actor.role}: "${character}" is not a character id (a namespace, a colon and a path)` });
    }

    if (problems.some(problem => problem.severity === 'error'))
        return { files: [], problems };

    const files: ExportedFile[] = [];

    for (const actor of stage.actors) {
        const clips = stage.animations.map(animation => clipFor(actor, animation, problems));

        files.push({ path: clipFilePath(stage, actor, options.characters?.[actor.role]), bytes: encodeAnimation(animationFile(clips, actor.skeleton)) });
    }

    files.push({ path: `assets/${stage.namespace}/strut/scenes/${stage.scene}.strutscene`, text: layoutText(stage) });

    return { files, problems };
}

/** One actor's clip for one animation: the track with its shift applied and its stage offset folded into the root */
export function clipFor(actor: StageActor, animation: StageAnimation, problems: Problem[] = []): RawClip {
    const track = animation.tracks[actor.role];
    const shift = track?.shift ?? 0;
    const shifted = (time: number): number => {
        const moved = time + shift;

        if (moved < 0) {
            problems.push({ severity: 'warning', message: `${actor.role} has a key or event at ${time}s in "${animation.name}" that the ${shift}s shift moves before the start; it is put at 0` });

            return 0;
        }

        return moved;
    };

    const channels: RawChannel[] = (track?.channels ?? []).map(channel => ({ ...channel, keys: channel.keys.map((key): RawKey => ({ ...key, time: shifted(key.time) })) }));
    const events: RawEvent[] = (track?.events ?? []).map(event => ({ ...event, time: shifted(event.time) }));
    const folded = foldStageOffset(channels, actor.roots, actor.offset);

    for (const message of folded.problems)
        problems.push({ severity: 'warning', message: `${animation.name}: ${message}` });

    return { name: animation.name, duration: animation.duration, loop: animation.loop, channels: folded.channels, events };
}

/** A role's clips as a file made for {@code skeletonId} (matched by it in game, whichever model plays it) */
function animationFile(clips: readonly RawClip[], skeletonId: string): RawBinaryAnimation {
    const strings = new StringTable();

    for (const clip of clips) {
        strings.intern(clip.name);

        for (const channel of clip.channels) {
            strings.intern(channel.target);

            for (const key of channel.keys) {
                internValue(strings, key.value);

                if (key.post !== null)
                    internValue(strings, key.post);

                if (key.easing !== null)
                    strings.intern(key.easing);
            }
        }

        for (const event of clip.events) {
            strings.intern(event.kind);
            strings.intern(event.payload);
        }
    }

    strings.intern(skeletonId);

    return { version: ANIMATION_VERSION, flags: 0, skeletonFingerprint: 0, skeletonId, strings: strings.entries(), clips };
}

function internValue(strings: StringTable, value: RawValue): void {
    for (const expression of value.expressions) {
        if (expression !== null)
            strings.intern(expression);
    }
}

function idPath(id: string): string {
    return id.slice(id.indexOf(':') + 1);
}

function idNamespace(id: string): string {
    return id.slice(0, id.indexOf(':'));
}

/** Where an actor's clips are written: its clip set's file for the skeleton (in the skeleton id's namespace), or for one character (in the character's) */
export function clipFilePath(stage: Stage, actor: StageActor, character?: string): string {
    const set = `scenes/${stage.scene}/${actor.role}`;

    return character === undefined
        ? `assets/${idNamespace(actor.skeleton)}/strut/animations/${set}/skeletons/${idPath(actor.skeleton)}.strutanim`
        : `assets/${idNamespace(character)}/strut/animations/${set}/characters/${idPath(character)}.strutanim`;
}

const LAYOUT_LOOP: Record<LoopModeName, string> = { PLAY_ONCE: 'once', LOOP: 'loop', HOLD_ON_LAST_FRAME: 'hold' };

/** The scene's layout file ({@code strut/scenes/<scene>.strutscene}): its roles, who may fill them, and each clip's length and loop mode */
export function layoutText(stage: Stage): string {
    const roles: Record<string, unknown> = {};

    for (const actor of stage.actors) {
        roles[actor.role] = {
            clipSet: `scenes/${stage.scene}/${actor.role}`,
            skeleton: actor.skeleton,
            ...(actor.compatible && actor.compatible.length > 0 ? { compatible: actor.compatible } : {}),
            ...(actor.required === false ? { required: false } : {}),
            ...(actor.camera ? { camera: actor.camera } : {}),
            ...(actor.lead ? { lead: true } : {}),
        };
    }

    const clips: Record<string, unknown> = {};

    for (const animation of stage.animations)
        clips[animation.name] = {
            length: Math.round(animation.duration * TICKS_PER_SECOND),
            loop: LAYOUT_LOOP[animation.loop],
            ...(animation.phase ? { phase: animation.phase } : {}),
            ...(animation.variant ? { variant: animation.variant } : {}),
            ...(animation.side ? { side: animation.side } : {}),
        };

    return JSON.stringify({ roles, clips }, null, 2);
}
