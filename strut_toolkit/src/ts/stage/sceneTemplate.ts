import { LoopModeName } from '../binary/animation';
import { isValidSkeletonId } from '../binary/skeletonId';
import { Problem, Stage } from './stageFormat';

/**
 * Scene templates: what kind of scene is being made, who takes part in it, and which clips it has, in what form
 * <p>
 * Strut itself has no kinds of scene: a scene is roles that play clips. A mod has them (a scene on a bed, a scene with a player, a fight with two sides), each with its
 * own roles, its own clips and its own rules for naming and timing them. A template says that once, so the person making a scene is told what is still missing instead
 * of having to know it, and the export is checked against it. Templates are data: a mod, a pack tool or another plugin registers them ({@link ./templateRegistry})
 * <pre>
 * { "version": 1, "templates": [ {
 *     "id": "mymod:on_bed", "name": "On a bed", "group": "Mymod", "description": "Two on a bed",
 *     "roles": [ { "id": "host", "name": "Host", "skeleton": "mymod:humanoid", "lead": true, "presetGroup": "Characters" },
 *                { "id": "guest", "name": "Guest", "required": false } ],
 *     "clips": { "naming": "animation.{scene}.{phase}",
 *                "phases": [ { "id": "intro", "name": "Intro", "loop": "loop", "required": true, "seconds": { "min": 1, "max": 10 } },
 *                            { "id": "slow", "name": "Slow", "loop": "loop", "variants": { "min": 1, "max": 4 }, "sides": ["L", "R"] } ] },
 *     "rules": { "keyedRoles": ["host"] } } ] }
 * </pre>
 * Pure: no Blockbench
 */

export const TEMPLATE_VERSION = 1;

export interface TemplateRole {
    /** The role's name in the scene (and in the clip set folder) */
    readonly id: string;
    /** What the person is shown */
    readonly name: string;
    readonly description: string;
    /** The skeleton id a character in this role must be on, or empty for any */
    readonly skeleton: string;
    readonly compatible: readonly string[];
    readonly required: boolean;
    readonly lead: boolean;
    readonly camera: string;
    /** The heading of the actor presets to offer for this role, or empty for all */
    readonly presetGroup: string;
}

export interface Range {
    readonly min: number;
    readonly max: number;
}

export interface TemplatePhase {
    /** What the layout's {@code phase} says */
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** The loop mode every clip of the phase has: once, loop or hold. A new clip of the phase is made with it */
    readonly loop: 'once' | 'loop' | 'hold';
    /** The template does not check the loop mode of the phase's clips ({@code "loop": "any"}); a new clip is made looping */
    readonly loopAny: boolean;
    /** Whether the scene must have a clip of this phase */
    readonly required: boolean;
    /** How many variants of the phase there may be (counting from 1) */
    readonly variants: Range;
    /** Sides a clip of the phase comes in: each variant needs one clip per side. Empty for none */
    readonly sides: readonly string[];
    /** A variant may be one plain clip with no side instead of the sided ones (not both) */
    readonly sidesOptional: boolean;
    /** The sides a sided variant must have all of; the others it may have. All of {@code sides} unless the template says */
    readonly sidesRequired: readonly string[];
    /** How long a clip of the phase may be, in seconds; max 0 for no limit */
    readonly seconds: Range;
}

export interface SceneTemplate {
    readonly id: string;
    readonly name: string;
    readonly group: string;
    readonly description: string;
    readonly roles: readonly TemplateRole[];
    /** The clip name's form: {@code {scene}} and {@code {phase}} are put in. A variant above 1 adds {@code _<n>} and a side {@code _<side>} */
    readonly naming: string;
    readonly phases: readonly TemplatePhase[];
    /** Whether a clip that is no phase of the template is allowed */
    readonly freeClips: boolean;
    /** Roles that must have keys in every clip */
    readonly keyedRoles: readonly string[];
}

export interface TemplateParse {
    readonly templates: readonly SceneTemplate[];
    /** What was wrong with templates that were left out, and with parts that were fixed */
    readonly problems: readonly string[];
}

const ID = /^[a-z0-9_.-]+(:[a-z0-9_./-]+)?$/;
const ROLE = /^[a-z0-9_./-]+$/;
const PHASE = /^[a-z0-9_]+$/;
const LOOPS = ['once', 'loop', 'hold'];

function text(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function range(value: any, fallback: Range): Range {
    const min = Number(value?.min);
    const max = Number(value?.max);

    return { min: Number.isFinite(min) ? min : fallback.min, max: Number.isFinite(max) ? max : fallback.max };
}

/** Reads a {@code templates.json}; a template that cannot be used is left out and reported, a part that can be mended is mended and reported */
export function parseTemplates(json: string, source: string): TemplateParse {
    const problems: string[] = [];
    let root: any;

    try {
        root = JSON.parse(json);
    }
    catch {
        return { templates: [], problems: [`${source}: not valid JSON`] };
    }

    if (typeof root?.version === 'number' && root.version > TEMPLATE_VERSION)
        return { templates: [], problems: [`${source}: templates of version ${root.version}, newer than this build reads (${TEMPLATE_VERSION})`] };

    return parseTemplateList(Array.isArray(root?.templates) ? root.templates : [], source, problems);
}

/** The same for templates already as objects (a plugin handing them over) */
export function parseTemplateList(entries: readonly unknown[], source: string, problems: string[] = []): TemplateParse {
    const templates: SceneTemplate[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        const template = parseTemplate(entry, source, problems);

        if (!template)
            continue;

        if (seen.has(template.id)) {
            problems.push(`${source}: the template ${template.id} is listed twice; the first is kept`);
            continue;
        }

        seen.add(template.id);
        templates.push(template);
    }

    return { templates, problems };
}

function parseTemplate(entry: any, source: string, problems: string[]): SceneTemplate | null {
    const id = text(entry?.id);

    if (!ID.test(id)) {
        problems.push(`${source}: a template has no valid id ("${id}")`);

        return null;
    }

    const where = `${source}: ${id}`;
    const roles: TemplateRole[] = [];

    for (const role of Array.isArray(entry.roles) ? entry.roles : []) {
        const roleId = text(role?.id);

        if (!ROLE.test(roleId) || roles.some(each => each.id === roleId)) {
            problems.push(`${where}: a role has no valid id, or the id is used twice ("${roleId}"); it is left out`);
            continue;
        }

        const skeleton = text(role.skeleton);

        if (skeleton !== '' && !isValidSkeletonId(skeleton)) {
            problems.push(`${where}: the role ${roleId} names "${skeleton}", which is not a skeleton id; it is read as any`);
        }

        roles.push({
            id: roleId,
            name: text(role.name, roleId) || roleId,
            description: text(role.description),
            skeleton: skeleton !== '' && isValidSkeletonId(skeleton) ? skeleton : '',
            compatible: (Array.isArray(role.compatible) ? role.compatible : []).map((each: unknown) => text(each)).filter((each: string) => isValidSkeletonId(each)),
            required: role.required !== false,
            lead: role.lead === true,
            camera: text(role.camera),
            presetGroup: text(role.presetGroup),
        });
    }

    if (roles.length === 0) {
        problems.push(`${where}: a template needs at least one role; it is left out`);

        return null;
    }

    const clips = entry.clips ?? {};
    const naming = text(clips.naming, 'animation.{scene}.{phase}') || 'animation.{scene}.{phase}';

    if (!naming.includes('{phase}'))
        problems.push(`${where}: the naming has no {phase}, so two phases would have one name`);

    const phases: TemplatePhase[] = [];

    for (const phase of Array.isArray(clips.phases) ? clips.phases : []) {
        const phaseId = text(phase?.id);

        if (!PHASE.test(phaseId) || phases.some(each => each.id === phaseId)) {
            problems.push(`${where}: a phase has no valid id, or the id is used twice ("${phaseId}"); it is left out`);
            continue;
        }

        const loop = text(phase.loop, 'loop');
        const sides: string[] = (Array.isArray(phase.sides) ? phase.sides : []).map((each: unknown) => text(each)).filter((each: string) => /^[A-Za-z0-9_]+$/.test(each));
        const sidesRequired: string[] = Array.isArray(phase.sidesRequired) ? phase.sidesRequired.map((each: unknown) => text(each)).filter((each: string) => sides.includes(each)) : sides;
        // a phase that is required has one clip at least, one that is not may have none, unless it says how many
        const variants = range(phase.variants, { min: phase.required === true ? 1 : 0, max: 1 });

        phases.push({
            id: phaseId,
            name: text(phase.name, phaseId) || phaseId,
            description: text(phase.description),
            loop: (LOOPS.includes(loop) ? loop : 'loop') as TemplatePhase['loop'],
            loopAny: loop === 'any',
            // asking for at least one variant is requiring the phase
            required: phase.required === true || variants.min >= 1,
            variants: { min: Math.max(0, Math.floor(variants.min)), max: Math.max(1, Math.floor(variants.max)) },
            sides,
            sidesOptional: phase.sidesOptional === true && sides.length > 0,
            sidesRequired,
            seconds: range(phase.seconds, { min: 0, max: 0 }),
        });
    }

    const rules = entry.rules ?? {};

    return {
        id,
        name: text(entry.name, id) || id,
        group: text(entry.group, source) || source,
        description: text(entry.description),
        roles,
        naming,
        phases,
        freeClips: clips.freeClips !== false && phases.length === 0 || clips.freeClips === true,
        keyedRoles: (Array.isArray(rules.keyedRoles) ? rules.keyedRoles : []).map((each: unknown) => text(each)).filter((each: string) => roles.some(role => role.id === each)),
    };
}

// ===============================================================
// Clip names
// ===============================================================

/** The name of the clip for a phase of a scene: {@code variant} from 1 (1 adds nothing), {@code side} one of the phase's sides or empty */
export function clipName(template: SceneTemplate, scene: string, phase: string, variant = 1, side = ''): string {
    const base = template.naming.split('{scene}').join(scene).split('{phase}').join(phase);

    return base + (side !== '' ? `_${side}` : '') + (variant > 1 ? `_${variant}` : '');
}

export interface ClipIdentity {
    readonly phase: string;
    readonly variant: number;
    readonly side: string;
}

/** What a clip of this scene is, from its name and the template: null for a name that is no phase of it */
export function identify(template: SceneTemplate, scene: string, name: string): ClipIdentity | null {
    for (const phase of template.phases) {
        const sides = phase.sides.length > 0 ? (phase.sidesOptional ? ['', ...phase.sides] : phase.sides) : [''];

        for (const side of sides) {
            for (let variant = 1; variant <= Math.max(phase.variants.max, 1) + 8; variant++) {
                if (clipName(template, scene, phase.id, variant, side) === name)
                    return { phase: phase.id, variant, side };
            }
        }
    }

    return null;
}

/** The loop mode name Blockbench and the stage use for a template's */
export function loopOf(loop: TemplatePhase['loop']): LoopModeName {
    return loop === 'loop' ? 'LOOP' : loop === 'hold' ? 'HOLD_ON_LAST_FRAME' : 'PLAY_ONCE';
}

// ===============================================================
// What is still missing
// ===============================================================

export interface PhaseStatus {
    readonly phase: TemplatePhase;
    /** The clips of the scene that are this phase's */
    readonly clips: readonly string[];
    /** What the phase still needs, in words; empty when it is fine */
    readonly missing: readonly string[];
}

/** Each phase of the template against the scene's animations */
export function phaseStatus(template: SceneTemplate, scene: string, animations: readonly { name: string; duration: number; loop: LoopModeName }[]): PhaseStatus[] {
    return template.phases.map(phase => {
        const mine = animations.filter(animation => identify(template, scene, animation.name)?.phase === phase.id);
        const missing: string[] = [];
        const variants = new Set<number>();
        const sides = new Map<number, Set<string>>();

        for (const animation of mine) {
            const identity = identify(template, scene, animation.name)!;

            variants.add(identity.variant);

            if (!sides.has(identity.variant))
                sides.set(identity.variant, new Set());

            sides.get(identity.variant)!.add(identity.side);

            if (!phase.loopAny && loopOf(phase.loop) !== animation.loop)
                missing.push(`${animation.name} should be ${phase.loop === 'once' ? 'play once' : phase.loop === 'loop' ? 'looping' : 'hold on last frame'}`);

            if (phase.seconds.min > 0 && animation.duration < phase.seconds.min - 1e-6)
                missing.push(`${animation.name} is shorter than ${phase.seconds.min}s`);

            if (phase.seconds.max > 0 && animation.duration > phase.seconds.max + 1e-6)
                missing.push(`${animation.name} is longer than ${phase.seconds.max}s`);
        }

        const needed = Math.max(phase.variants.min, phase.required ? 1 : 0);

        if (variants.size < needed)
            missing.unshift(needed === 1 ? 'no clip yet' : `${variants.size} of at least ${needed} variants`);

        if (variants.size > phase.variants.max)
            missing.push(`${variants.size} variants, at most ${phase.variants.max}`);

        for (const [variant, have] of sides) {
            if (phase.sidesOptional && have.has('')) {
                // one plain clip is a whole variant: it must not also have sided clips
                if (have.size > 1)
                    missing.push(`variant ${variant} has a plain clip and sided ones: use one or the other`);

                continue;
            }

            for (const side of phase.sidesRequired) {
                if (!have.has(side))
                    missing.push(`variant ${variant} has no ${side} clip`);
            }
        }

        return { phase, clips: mine.map(animation => animation.name), missing };
    });
}

/** The template's own checks of a scene: who is missing, whose skeleton is wrong, which phases lack clips, which clips break a rule */
export function checkAgainstTemplate(template: SceneTemplate, stage: Stage): Problem[] {
    const problems: Problem[] = [];
    const add = (severity: Problem['severity'], message: string): void => void problems.push({ severity, message });

    for (const role of template.roles) {
        const actor = stage.actors.find(each => each.role === role.id);

        if (!actor) {
            if (role.required)
                add('error', `the role ${role.name} (${role.id}) has no character yet`);

            continue;
        }

        if (role.skeleton !== '' && actor.skeleton !== role.skeleton && !role.compatible.includes(actor.skeleton))
            add('error', `${role.name} must be on the skeleton ${role.skeleton}${role.compatible.length > 0 ? ` (or ${role.compatible.join(', ')})` : ''}, not ${actor.skeleton}`);
    }

    for (const status of phaseStatus(template, stage.scene, stage.animations)) {
        for (const message of status.missing)
            add(status.phase.required || status.clips.length > 0 ? 'error' : 'warning', `${status.phase.name}: ${message}`);
    }

    for (const animation of stage.animations) {
        if (identify(template, stage.scene, animation.name) === null && !template.freeClips)
            add('warning', `${animation.name} is not a clip of this kind of scene (it should be named like ${clipName(template, stage.scene, template.phases[0]?.id ?? 'phase')})`);

        for (const role of template.keyedRoles) {
            const track = animation.tracks[role];

            if (stage.actors.some(actor => actor.role === role) && (!track || track.channels.length === 0))
                add('warning', `${role} has no keys in ${animation.name}`);
        }
    }

    return problems;
}
