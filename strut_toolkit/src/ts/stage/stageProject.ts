/* eslint-disable @typescript-eslint/no-explicit-any */
import { loopModeFromLive, loopModeToLive } from '../binary/animationMapping';
import { RawBinaryModel } from '../binary/model';
import { decodeSkeletonId, SKELETON_SECTION } from '../binary/skeletonId';
import { StringTable } from '../binary/writer';
import { PROPERTY_STAGE } from '../constants';
import { addChannelsToAnimation, buildClip, buildEvents } from '../strutAnimationCodec';
import { buildProjectFromModel } from '../strutCodec';
import { exportStage, ExportedFile, ExportOptions } from './stageExport';
import { newStage, Problem, Stage, StageActor, StageAnimation, StageRoot, StageTrack } from './stageFormat';
import { checkAgainstTemplate, clipName, identify, loopOf, phaseStatus, PhaseStatus, SceneTemplate, TemplatePhase } from './sceneTemplate';

/**
 * A workspace in Blockbench: an open Strut project whose top level groups named {@code @<role>} are actors
 * <p>
 * An actor is a locked copy of a preview model's bones under its {@code @role} group (the geometry is there to look at, never to edit), so every tool Blockbench has
 * for animating groups works on it: the timeline, the graph editor, keyframes, onion skinning. Where the actor stands on the stage is the {@code @role} group's own
 * move and turn, set with the normal gizmo in edit mode. What is not Blockbench's to keep (which skeleton an actor is, who may fill the role, the scene's name) is
 * one JSON text in a project property ({@link PROPERTY_STAGE}), like the physics are
 * <p>
 * {@link readStage} reads the whole thing back as the plain {@link Stage} the exporter works on, so everything here is reading and writing the open project; what the
 * export does with it is {@code stageExport.ts}, and is tested without Blockbench
 */

export const ACTOR_PREFIX = '@';

/** What the project property holds: what Blockbench does not */
export interface StageMeta {
    scene: string;
    namespace: string;
    /** What kind of scene this is: the whole template, kept with the scene so it opens without the plugin that registered it */
    template?: SceneTemplate;
    actors: Record<string, ActorMeta>;
    animations: Record<string, AnimationMeta>;
}

export interface ActorMeta {
    skeleton: string;
    model?: string;
    compatible?: string[];
    required?: boolean;
    camera?: string;
    lead?: boolean;
    /** The pivots of the preview model's top level bones as it was loaded, by bone name: the game's own, which the exported clips are made for (moving the actor in the editor moves the bones' pivots) */
    pivots?: Record<string, [number, number, number]>;
    /** The uuids of the textures loaded for the actor's model, so swapping the model takes them out again */
    textures?: string[];
}

export interface AnimationMeta {
    phase?: string;
    variant?: number;
    side?: string;
    /** Seconds each actor's tracks are moved, by role */
    shifts?: Record<string, number>;
}

// ===============================================================
// The metadata
// ===============================================================

export function readMeta(): StageMeta | null {
    const text = String((Project as any)?.[PROPERTY_STAGE] ?? '');

    if (text === '')
        return null;

    try {
        const meta = JSON.parse(text);

        return { scene: meta.scene ?? '', namespace: meta.namespace ?? '', ...(meta.template ? { template: meta.template } : {}), actors: meta.actors ?? {}, animations: meta.animations ?? {} };
    }
    catch {
        console.warn('[Strut] The workspace data of this project is damaged and was ignored.');

        return null;
    }
}

export function writeMeta(meta: StageMeta): void {
    (Project as any)[PROPERTY_STAGE] = JSON.stringify(meta);
}

/** The metadata of the open project, started from {@code scene} and {@code namespace} if it has none */
export function metaOrNew(scene: string, namespace: string): StageMeta {
    return readMeta() ?? { scene, namespace, actors: {}, animations: {} };
}

// ===============================================================
// The actors
// ===============================================================

/** The actors of the open project: its top level groups named {@code @<role>}, by role */
export function actorGroups(): Map<string, any> {
    const actors = new Map<string, any>();

    for (const node of (Outliner as any).root as any[]) {
        if (node instanceof Group && typeof node.name === 'string' && node.name.startsWith(ACTOR_PREFIX) && node.name.length > ACTOR_PREFIX.length)
            actors.set(node.name.slice(ACTOR_PREFIX.length), node);
    }

    return actors;
}

/** Whether {@code node} is {@code group} or somewhere under it */
export function isUnder(node: any, group: any): boolean {
    for (let at = node; at; at = at.parent) {
        if (at === group)
            return true;
    }

    return false;
}

/**
 * Adds an actor: {@code model}'s bones under a new locked group {@code @role}, and the actor's data
 * <p>
 * The textures the format carries no pixels for are the usual magenta and black placeholders; the preview is for posing, not for looking nice
 *
 * @throws Error if the role is taken or the model's own skeleton id is not {@code skeleton}
 */
export function addActor(role: string, skeleton: string, model: RawBinaryModel, modelName: string, extra: Partial<ActorMeta> = {}, images?: ReadonlyMap<string, string>): any {
    if (!/^[a-z0-9_./-]+$/.test(role))
        throw new Error(`"${role}" is not a role name (lower case letters, digits, _ . / -)`);

    if (actorGroups().has(role))
        throw new Error(`there already is an actor called "${role}"`);

    checkSkeleton(model, skeleton, modelName);

    const group = new (Group as any)({ name: ACTOR_PREFIX + role, origin: [0, 0, 0] });

    group.init().addTo();

    const loaded = loadModelInto(group, model, images);
    const meta = metaOrNew(String((Project as any).name || 'scene'), '');

    meta.actors[role] = { skeleton, model: modelName, pivots: loaded.pivots, textures: loaded.textures, ...extra };
    meta.namespace = meta.namespace || skeleton.slice(0, skeleton.indexOf(':'));
    meta.scene = meta.scene === 'scene' || meta.scene === '' ? sceneNameOf(String((Project as any).name || 'scene')) : meta.scene;
    writeMeta(meta);
    (Canvas as any).updateAll?.();

    return group;
}

function checkSkeleton(model: RawBinaryModel, skeleton: string, modelName: string): void {
    const section = model.extensions?.get(SKELETON_SECTION);
    const modelId = section ? decodeSkeletonId(section) : null;

    if (modelId !== null && modelId !== skeleton)
        throw new Error(`${modelName} is on the skeleton ${modelId}, not ${skeleton}; a model can only play an actor of its own skeleton`);
}

/** Loads a model's bones under an actor group, locks its geometry, and says which pivots and textures it brought */
function loadModelInto(group: any, model: RawBinaryModel, images?: ReadonlyMap<string, string>): { pivots: Record<string, [number, number, number]>; textures: string[] } {
    const before = new Set(((Texture as any).all as any[]).map(texture => texture.uuid));
    const groups = buildProjectFromModel(model, group, images);

    for (const element of [...Cube.all, ...(Mesh as any).all] as any[]) {
        if (groups.some(bone => isUnder(element, bone)))
            element.locked = true;
    }

    const pivots: Record<string, [number, number, number]> = {};

    for (const child of group.children as any[]) {
        if (child instanceof Group)
            pivots[child.name] = [child.origin[0], child.origin[1], child.origin[2]];
    }

    return { pivots, textures: ((Texture as any).all as any[]).map(texture => texture.uuid).filter(uuid => !before.has(uuid)) };
}

/**
 * Gives an actor another preview model of the same skeleton, keeping every keyframe: the tracks are read by bone name, the old bones and textures are taken out, the
 * new model is loaded, and the tracks are put back on the new bones. Keys for a bone the new model does not have are dropped and counted
 *
 * @returns how many channels had no bone to go to
 */
export function swapActorModel(role: string, model: RawBinaryModel, modelName: string, images?: ReadonlyMap<string, string>): number {
    const group = actorGroups().get(role);
    const meta = readMeta();
    const data = meta?.actors[role];

    if (!group || !meta || !data)
        throw new Error(`there is no actor called "${role}"`);

    checkSkeleton(model, data.skeleton, modelName);

    const animations: any[] = (Project as any).animations ?? [];
    const kept = animations.map(animation => ({ animation, clip: buildClip(animation, new StringTable(), node => isUnder(node, group)) }));

    // out with the old bones, their animators, their textures
    for (const { animation } of kept) {
        for (const uuid of Object.keys(animation.animators ?? {})) {
            const node = (OutlinerNode as any).uuids?.[uuid];

            if (node && isUnder(node, group))
                delete animation.animators[uuid];
        }
    }

    for (const child of [...group.children] as any[])
        child.remove(true);

    for (const uuid of data.textures ?? []) {
        const old = ((Texture as any).all as any[]).find(texture => texture.uuid === uuid);

        old?.remove?.(true);
    }

    const loaded = loadModelInto(group, model, images);

    data.model = modelName;
    data.pivots = loaded.pivots;
    data.textures = loaded.textures;
    writeMeta(meta);

    let dropped = 0;

    for (const { animation, clip } of kept) {
        const bones = new Set<string>();

        for (const child of group.children as any[])
            collectNames(child, bones);

        dropped += clip.channels.filter(channel => !bones.has(channel.target)).length;
        addChannelsToAnimation(animation, { ...clip, events: [] }, group);
    }

    (Canvas as any).updateAll?.();

    return dropped;
}

function collectNames(node: any, into: Set<string>): void {
    into.add(node.name);

    for (const child of node.children ?? [])
        collectNames(child, into);
}

/** Shows or hides an actor in the viewport (its keyframes are kept and exported either way) */
export function setActorVisible(role: string, visible: boolean): void {
    const group = actorGroups().get(role);

    if (!group)
        return;

    group.visibility = visible;
    group.updateVisibility?.();
    (Canvas as any).updateVisibility?.();
}

/** What the Actors panel shows */
export interface ActorRow {
    readonly role: string;
    readonly skeleton: string;
    readonly model: string;
    readonly visible: boolean;
    readonly lead: boolean;
    readonly required: boolean;
}

export function actorRows(): ActorRow[] {
    const meta = readMeta();

    return [...actorGroups()].map(([role, group]) => ({
        role,
        skeleton: meta?.actors[role]?.skeleton ?? '',
        model: meta?.actors[role]?.model ?? '',
        visible: group.visibility !== false,
        lead: meta?.actors[role]?.lead === true,
        required: meta?.actors[role]?.required !== false,
    }));
}

export function removeActor(role: string): void {
    const group = actorGroups().get(role);

    const meta = readMeta();

    if (group)
        group.remove(true);

    for (const uuid of meta?.actors[role]?.textures ?? [])
        ((Texture as any).all as any[]).find(texture => texture.uuid === uuid)?.remove?.(true);

    if (meta) {
        delete meta.actors[role];

        for (const animation of Object.values(meta.animations))
            delete animation.shifts?.[role];

        writeMeta(meta);
    }
}

// ===============================================================
// Reading the project as a Stage
// ===============================================================

export interface ReadStage {
    readonly stage: Stage | null;
    /** What could not be read as asked, shown with the export's own problems */
    readonly problems: readonly Problem[];
}

/** A scene name from a project name: lower case, with anything else turned into an underscore */
function sceneNameOf(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'scene';
}

/**
 * Where an actor's bones stand on the stage, from its {@code @role} group. The group is turned about its own pivot {@code O}, and moving it with the gizmo moves its
 * children's pivots by {@code d} (the bones' pivots now against the ones the model was loaded with), so a point {@code x} of the model ends up at
 * {@code O + Ry(x + d - O)}: a turn about the origin, then the move {@code O + Ry(d - O)}
 */
export function offsetOf(group: any, shift: [number, number, number] = [0, 0, 0]): { position: [number, number, number]; yaw: number; tilted: boolean } {
    const origin: [number, number, number] = [group.origin[0], group.origin[1], group.origin[2]];
    const yaw = Number(group.rotation?.[1] ?? 0);
    const radians = yaw * Math.PI / 180;
    const turn = (x: number, z: number): [number, number] => [x * Math.cos(radians) + z * Math.sin(radians), -x * Math.sin(radians) + z * Math.cos(radians)];
    const [tx, tz] = turn(shift[0] - origin[0], shift[2] - origin[2]);

    return {
        position: [origin[0] + tx, shift[1], origin[2] + tz],
        yaw,
        tilted: Math.abs(Number(group.rotation?.[0] ?? 0)) > 1e-6 || Math.abs(Number(group.rotation?.[2] ?? 0)) > 1e-6,
    };
}

export function readStage(): ReadStage {
    const meta = readMeta();
    const problems: Problem[] = [];

    if (!meta)
        return { stage: null, problems: [{ severity: 'error', message: 'this project is not a scene yet: add a character first' }] };

    const groups = actorGroups();
    const actors: StageActor[] = [];

    for (const [role, group] of groups) {
        const data = meta.actors[role];

        if (!data) {
            problems.push({ severity: 'error', message: `the group @${role} is not an actor (it has no workspace data); remove it or add the actor again` });
            continue;
        }

        const loaded = (group.children as any[]).filter(child => child instanceof Group);
        // the game's pivots, which the clips are made for; an actor from before they were kept uses the bones' pivots as they are
        const roots: StageRoot[] = loaded.map(child => ({ bone: child.name as string, pivot: data.pivots?.[child.name] ?? [child.origin[0], child.origin[1], child.origin[2]] }));
        const first = loaded[0];
        const was = first ? data.pivots?.[first.name] : undefined;
        const shift: [number, number, number] = first && was ? [first.origin[0] - was[0], first.origin[1] - was[1], first.origin[2] - was[2]] : [0, 0, 0];
        const offset = offsetOf(group, shift);

        for (const child of loaded) {
            const had = data.pivots?.[child.name];

            if (had && (Math.abs(child.origin[0] - had[0] - shift[0]) > 1e-4 || Math.abs(child.origin[1] - had[1] - shift[1]) > 1e-4 || Math.abs(child.origin[2] - had[2] - shift[2]) > 1e-4))
                problems.push({ severity: 'warning', message: `the bones of @${role} were not all moved by the same amount; the stage offset follows ${first.name}` });
        }

        if (offset.tilted)
            problems.push({ severity: 'error', message: `@${role} is turned about x or z; a stage turn is about the vertical axis only` });

        if (roots.length === 0)
            problems.push({ severity: 'error', message: `@${role} has no bones` });

        actors.push({
            role,
            skeleton: data.skeleton,
            ...(data.model ? { model: data.model } : {}),
            roots,
            offset: { position: offset.position, yaw: offset.yaw },
            ...(data.compatible && data.compatible.length > 0 ? { compatible: data.compatible } : {}),
            ...(data.required === false ? { required: false } : {}),
            ...(data.camera ? { camera: data.camera } : {}),
            ...(data.lead ? { lead: true } : {}),
        });
    }

    for (const role of Object.keys(meta.actors)) {
        if (!groups.has(role))
            problems.push({ severity: 'warning', message: `the actor ${role} has data but no @${role} group; the data is ignored` });
    }

    const animations: StageAnimation[] = ((Project as any).animations as any[] ?? []).map(animation => {
        // what a clip is comes from the kind of scene when it has one (its name says), and from what was typed for it when not
        const known = meta.template ? identify(meta.template, meta.scene, animation.name) : null;
        const tags = { ...(known ? { phase: known.phase, variant: known.variant, side: known.side } : {}), ...(meta.animations[animation.name] ?? {}) };
        const tracks: Record<string, StageTrack> = {};
        const strings = new StringTable();
        let first = true;

        for (const [role, group] of groups) {
            const clip = buildClip(animation, strings, node => isUnder(node, group));
            // the effects of the animation (sounds, particles, instructions) are one list in Blockbench: they are given to the first actor
            const events = first ? buildEvents(animation.animators?.effects, strings) : [];

            first = false;
            tracks[role] = { channels: clip.channels, events, ...(tags.shifts?.[role] ? { shift: tags.shifts[role] } : {}) };
        }

        return {
            name: animation.name,
            duration: animation.length || 0,
            loop: loopModeFromLive(animation.loop),
            ...(tags.phase ? { phase: tags.phase } : {}),
            ...(tags.variant ? { variant: tags.variant } : {}),
            ...(tags.side ? { side: tags.side } : {}),
            tracks,
        };
    });

    const stage: Stage = { ...newStage(meta.scene, meta.namespace), actors, animations };

    if (stage.scene === '')
        problems.push({ severity: 'error', message: 'the scene has no name' });

    if (stage.namespace === '')
        problems.push({ severity: 'error', message: 'the scene has no namespace' });

    if (meta.template)
        problems.push(...checkAgainstTemplate(meta.template, stage));

    return { stage, problems };
}

/** The files of the workspace as exported, with every problem found reading the project and exporting it */
export function exportWorkspaceFiles(options: ExportOptions = {}): { files: readonly ExportedFile[]; problems: readonly Problem[] } {
    const read = readStage();

    if (!read.stage || read.problems.some(problem => problem.severity === 'error'))
        return { files: [], problems: read.problems };

    const exported = exportStage(read.stage, options);

    return { files: exported.files, problems: [...read.problems, ...exported.problems] };
}

// ===============================================================
// What the Strut Scenes panel shows, and the clips it makes
// ===============================================================

export interface SlotRow {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
    readonly lead: boolean;
    readonly skeleton: string;
    readonly presetGroup: string;
    /** The actor in the slot, or null while it is empty */
    readonly actor: ActorRow | null;
}

export interface PhaseRow {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
    readonly loop: string;
    readonly sides: readonly string[];
    readonly maxVariants: number;
    readonly clips: readonly string[];
    readonly missing: readonly string[];
}

export interface SceneOverview {
    readonly scene: string;
    readonly namespace: string;
    readonly templateName: string;
    /** Whether the scene has no phases to fill: its clips are named by the person */
    readonly free: boolean;
    readonly slots: readonly SlotRow[];
    /** Actors whose role the template does not have */
    readonly others: readonly ActorRow[];
    readonly phases: readonly PhaseRow[];
    /** Every clip of the scene, in order */
    readonly clips: readonly string[];
}

/** A light reading of the scene for the panel: no keys are read, so it can be asked for often */
export function sceneOverview(): SceneOverview | null {
    const meta = readMeta();

    if (!meta)
        return null;

    const rows = actorRows();
    const animations = ((Project as any).animations as any[] ?? []).map(animation => ({ name: String(animation.name), duration: Number(animation.length) || 0, loop: loopModeFromLive(animation.loop) }));
    const template = meta.template ?? null;
    const slots: SlotRow[] = (template?.roles ?? []).map(role => ({
        id: role.id, name: role.name, description: role.description, required: role.required, lead: role.lead, skeleton: role.skeleton, presetGroup: role.presetGroup,
        actor: rows.find(row => row.role === role.id) ?? null,
    }));
    const phases: PhaseRow[] = template ? phaseStatus(template, meta.scene, animations).map((status: PhaseStatus) => ({
        id: status.phase.id, name: status.phase.name, description: status.phase.description, required: status.phase.required, loop: status.phase.loop,
        sides: status.phase.sides, maxVariants: status.phase.variants.max, clips: status.clips, missing: status.missing,
    })) : [];

    return {
        scene: meta.scene,
        namespace: meta.namespace,
        templateName: template?.name ?? '',
        free: !template || template.phases.length === 0,
        slots,
        others: rows.filter(row => !slots.some(slot => slot.id === row.role)),
        phases,
        clips: animations.map(animation => animation.name),
    };
}

/** The first variant of a phase, for a side, whose clip is not taken yet */
export function nextVariant(template: SceneTemplate, scene: string, phase: TemplatePhase, side: string, taken: ReadonlySet<string>): number {
    let variant = 1;

    while (taken.has(clipName(template, scene, phase.id, variant, side)))
        variant++;

    return variant;
}

/**
 * Makes the clip a phase of the template asks for, named as the template names it and set as it says (loop mode, a length in its range), and selects it
 *
 * @returns its name, or null if the phase's variants are all made
 */
export function addClipForPhase(phaseId: string, side = ''): string | null {
    const meta = readMeta();
    const template = meta?.template;
    const phase = template?.phases.find(each => each.id === phaseId);

    if (!meta || !template || !phase)
        return null;

    const taken = new Set<string>(((Project as any).animations as any[] ?? []).map(animation => String(animation.name)));
    const variant = nextVariant(template, meta.scene, phase, side, taken);

    if (variant > phase.variants.max)
        return null;

    const name = clipName(template, meta.scene, phase.id, variant, side);
    const length = phase.seconds.min > 0 ? phase.seconds.min : phase.seconds.max > 0 ? Math.min(2, phase.seconds.max) : 2;
    const animation = new (Animation as any)({ name, loop: loopModeToLive(loopOf(phase.loop)), length }).add();

    animation.select();

    return name;
}

/** A clip of a scene with no kind, named as the person says */
export function addFreeClip(name: string): string {
    const animation = new (Animation as any)({ name, loop: 'loop', length: 2 }).add();

    animation.select();

    return name;
}
