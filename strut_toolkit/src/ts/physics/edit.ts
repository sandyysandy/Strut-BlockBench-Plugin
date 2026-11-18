/**
 * Editing a model's physics through plain controls instead of typing JSON: turns the document into friendly numbers (a stiffness and a bounciness from 0 to 1
 * instead of hertz and a damping ratio) and back, and adds, changes and removes springs, chains and colliders in it. The document stays the same JSON the game
 * reads; anything this does not know about is kept. No Blockbench globals
 */
import { checkPhysics } from './config';
import { ColliderSpec } from './autoColliders';
import { V3 } from './math';
import { CLOTH_PRESET_VALUES, resolveCloth } from './cloth';
import { FLESH_PRESETS, resolveFlesh } from './flesh';

export type PartKind = 'none' | 'spring' | 'chain' | 'cloth' | 'flesh';

/** What the controls show for one spring bone or one chain */
export interface PartControls {
    /** 0 soft and floppy, 1 stiff and quick to return */
    stiffness: number;
    /** 0 dead and slow to swing, 1 wobbles a lot */
    bounce: number;
    /** 0 the animation alone, 1 full physics */
    weight: number;
    gravity: number;
    /** 0 rides rigidly with the model, 1 lags fully behind its motion */
    inertia: number;
    /** Spring: distance from the pivot to the swinging mass, blocks. Chain: how far the last bone reaches, blocks */
    length: number;
    /** Size of the swinging mass or of each hair particle for collision, blocks */
    radius: number;
    /** Spring only: how much it flattens under a press, 0 to 1 */
    squish: number;
    /** Chain only: how far a segment may bend from the animation, degrees, 0 for no limit */
    maxAngle: number;
    friction: number;
    collideBody: boolean;
    collideWorld: boolean;
    collideOthers: boolean;
}

export const MIN_HERTZ = 0.6;
export const MAX_HERTZ = 6.0;

export const hertzFromStiffness = (s: number): number => MIN_HERTZ + Math.max(0, Math.min(1, s)) * (MAX_HERTZ - MIN_HERTZ);
export const stiffnessFromHertz = (f: number): number => Math.max(0, Math.min(1, (f - MIN_HERTZ) / (MAX_HERTZ - MIN_HERTZ)));
export const dampingFromBounce = (b: number): number => 0.9 - 0.85 * Math.max(0, Math.min(1, b));
export const bounceFromDamping = (d: number): number => Math.max(0, Math.min(1, (0.9 - d) / 0.85));

export const SPRING_DEFAULTS: PartControls = {
    stiffness: stiffnessFromHertz(1.7), bounce: bounceFromDamping(0.24), weight: 1, gravity: 0, inertia: 1, length: 0.15, radius: 0.1, squish: 0, maxAngle: 0,
    friction: 0.2, collideBody: false, collideWorld: false, collideOthers: false,
};

export const CHAIN_DEFAULTS: PartControls = {
    stiffness: stiffnessFromHertz(3), bounce: bounceFromDamping(0.3), weight: 1, gravity: 9.8, inertia: 1, length: 0.15, radius: 0.05, squish: 0, maxAngle: 50,
    friction: 0.2, collideBody: true, collideWorld: true, collideOthers: false,
};

/** Ready-made looks the panel offers as one click; they set the controls, which then stay editable */
export const LOOKS: Record<string, { label: string; kind: PartKind; controls: Partial<PartControls> }> = {
    'jiggle-soft': { label: 'Soft jiggle', kind: 'spring', controls: { stiffness: stiffnessFromHertz(1.7), bounce: bounceFromDamping(0.24), gravity: 0 } },
    'jiggle-firm': { label: 'Firm jiggle', kind: 'spring', controls: { stiffness: stiffnessFromHertz(2.5), bounce: bounceFromDamping(0.32), gravity: 0 } },
    'soft-bone': { label: 'Squishy', kind: 'spring', controls: { stiffness: stiffnessFromHertz(2.2), bounce: bounceFromDamping(0.28), squish: 0.3, collideBody: true, collideOthers: true } },
    hair: { label: 'Hair', kind: 'chain', controls: { stiffness: stiffnessFromHertz(3), bounce: bounceFromDamping(0.3), maxAngle: 50, length: 0.15 } },
    tail: { label: 'Tail', kind: 'chain', controls: { stiffness: stiffnessFromHertz(1.6), bounce: bounceFromDamping(0.2), radius: 0.06, maxAngle: 70, length: 0.2 } },
    ear: { label: 'Ear', kind: 'chain', controls: { stiffness: stiffnessFromHertz(3.5), bounce: bounceFromDamping(0.2), gravity: 4, radius: 0.04, maxAngle: 40, length: 0.1 } },
};

export type Doc = Record<string, any>;

/** Parses the project's physics text; bad text gives an empty document (the dialog and the checker say what is wrong) */
export function readDoc(text: string): Doc {
    const check = checkPhysics(text || '{}');

    return check.document ?? {};
}

export function writeDoc(doc: Doc): string {
    return JSON.stringify(doc, null, 2);
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function layersOf(list: unknown, fallback: string[]): string[] {
    return Array.isArray(list) ? list.map(String) : fallback;
}

/** Which kind of part {@code bone} is in the document: a spring bone, the first bone of a chain (or any bone in one), or nothing */
export function kindOf(doc: Doc, bone: string): PartKind {
    if (doc.bones && doc.bones[bone]) return 'spring';

    if (chainNameOf(doc, bone) !== null) return 'chain';

    if (doc.cloth && doc.cloth[bone]) return 'cloth';

    return fleshEntryName(doc, bone) !== null ? 'flesh' : 'none';
}

export function chainNameOf(doc: Doc, bone: string): string | null {
    for (const [name, entry] of Object.entries(doc.chains ?? {})) {
        if (Array.isArray((entry as any)?.bones) && (entry as any).bones.includes(bone)) return name;
    }

    return null;
}

/** The controls for a spring bone (or the defaults if it has none) */
export function springControls(doc: Doc, bone: string): PartControls {
    const e = (doc.bones?.[bone] ?? {}) as Record<string, any>;
    const soft = e.preset === 'soft-bone';
    const layers = layersOf(e.collidesWith, soft ? ['other', 'players', 'mobs', 'body'] : []);

    return {
        ...SPRING_DEFAULTS,
        stiffness: stiffnessFromHertz(num(e.frequency, SPRING_DEFAULTS_HZ[e.preset as string] ?? 2)),
        bounce: bounceFromDamping(num(e.damping, SPRING_DEFAULTS_DAMPING[e.preset as string] ?? 0.25)),
        weight: num(e.weight, 1), gravity: num(e.gravity, 0), inertia: num(e.inertia, 1), length: num(e.length, 0.15), radius: num(e.radius, 0.1),
        squish: num(e.squish, soft ? 0.3 : 0),
        collideBody: layers.includes('body'), collideWorld: layers.includes('world'), collideOthers: layers.includes('other') || layers.includes('players'),
    };
}

const SPRING_DEFAULTS_HZ: Record<string, number> = { 'jiggle-soft': 1.7, 'jiggle-firm': 2.5, hair: 2.2, tail: 1.6, ear: 3.5, 'soft-bone': 2.2 };
const SPRING_DEFAULTS_DAMPING: Record<string, number> = { 'jiggle-soft': 0.24, 'jiggle-firm': 0.32, hair: 0.3, tail: 0.2, ear: 0.2, 'soft-bone': 0.28 };

/** The controls for the chain {@code bone} belongs to */
export function chainControls(doc: Doc, bone: string): PartControls {
    const name = chainNameOf(doc, bone);
    const e = (name ? doc.chains[name] : {}) as Record<string, any>;
    const layers = layersOf(e.collidesWith, ['body', 'world']);
    const presets: Record<string, Partial<Record<string, number>>> = {
        hair: { frequency: 3, damping: 0.3, gravity: 9.8, radius: 0.05, maxAngle: 50, tipLength: 0.15 },
        tail: { frequency: 1.6, damping: 0.2, gravity: 9.8, radius: 0.06, maxAngle: 70, tipLength: 0.2 },
        ear: { frequency: 3.5, damping: 0.2, gravity: 4, radius: 0.04, maxAngle: 40, tipLength: 0.1 },
    };
    const p = presets[e.preset as string] ?? {};

    return {
        ...CHAIN_DEFAULTS,
        stiffness: stiffnessFromHertz(num(e.frequency, p.frequency ?? 3)), bounce: bounceFromDamping(num(e.damping, p.damping ?? 0.3)),
        weight: num(e.weight, 1), gravity: num(e.gravity, p.gravity ?? 9.8), inertia: num(e.inertia, 1), length: num(e.tipLength, p.tipLength ?? 0.15),
        radius: num(e.radius, p.radius ?? 0.05), maxAngle: num(e.maxAngle, p.maxAngle ?? 0), friction: num(e.friction, 0.2),
        collideBody: layers.includes('body'), collideWorld: layers.includes('world'), collideOthers: layers.includes('other') || layers.includes('players'),
    };
}

const round = (v: number, places = 3): number => Math.round(v * 10 ** places) / 10 ** places;

/** Makes {@code bone} a spring bone with these controls (any keys the document already had for it that the controls do not cover are kept) */
export function setSpring(doc: Doc, bone: string, c: PartControls): Doc {
    const next: Doc = { ...doc, bones: { ...(doc.bones ?? {}) } };
    const old = (next.bones[bone] ?? {}) as Record<string, any>;
    const layers: string[] = [];

    if (c.collideBody) layers.push('body');
    if (c.collideWorld) layers.push('world');
    if (c.collideOthers) layers.push('other', 'players', 'mobs');

    // an old preset would fight the explicit numbers when the game reads it, so the numbers stand alone
    const rest = { ...old };
    const wasSoft = rest.preset === 'soft-bone';

    delete rest.preset;

    next.bones[bone] = {
        ...rest, frequency: round(hertzFromStiffness(c.stiffness)), damping: round(dampingFromBounce(c.bounce)), weight: round(c.weight), gravity: round(c.gravity, 2),
        inertia: round(c.inertia), length: round(c.length), radius: round(c.radius), squish: round(c.squish), collidesWith: layers,
    };

    if (wasSoft && rest.translate === undefined) next.bones[bone].translate = true;

    return next;
}

/** Makes the bones {@code bones} (each the child of the one before) a chain called after the first, with these controls */
export function setChain(doc: Doc, bones: readonly string[], c: PartControls): Doc {
    const name = chainNameOf(doc, bones[0]) ?? bones[0];
    const next: Doc = { ...doc, chains: { ...(doc.chains ?? {}) } };
    const old = (next.chains[name] ?? {}) as Record<string, any>;
    const layers: string[] = [];

    if (c.collideBody) layers.push('body');
    if (c.collideWorld) layers.push('world');
    if (c.collideOthers) layers.push('other', 'players', 'mobs');

    const rest = { ...old };

    delete rest.preset;

    next.chains[name] = {
        ...rest, bones: [...bones], frequency: round(hertzFromStiffness(c.stiffness)), damping: round(dampingFromBounce(c.bounce)), weight: round(c.weight),
        gravity: round(c.gravity, 2), inertia: round(c.inertia), radius: round(c.radius), maxAngle: round(c.maxAngle, 1), tipLength: round(c.length),
        friction: round(c.friction), collidesWith: layers,
    };

    return next;
}

/** Takes {@code bone} out of the physics: a spring bone is removed, a bone in a chain removes that whole chain */
export function removePart(doc: Doc, bone: string): Doc {
    const next: Doc = { ...doc };

    if (next.bones && next.bones[bone]) {
        next.bones = { ...next.bones };
        delete next.bones[bone];
    }

    const chain = chainNameOf(doc, bone);

    if (chain !== null) {
        next.chains = { ...next.chains };
        delete next.chains[chain];
    }

    const flesh = fleshEntryName(doc, bone);

    if (flesh !== null) {
        for (const section of ['flesh', 'soft']) {
            if (next[section] && next[section][flesh]) {
                next[section] = { ...next[section] };
                delete next[section][flesh];

                if (Object.keys(next[section]).length === 0) delete next[section];
            }
        }
    }

    for (const section of ['cloth']) {
        if (next[section] && next[section][bone]) {
            next[section] = { ...next[section] };
            delete next[section][bone];

            if (Object.keys(next[section]).length === 0) delete next[section];
        }
    }

    return next;
}

/**
 * The bones a chain from {@code bone} would use: the bone and then, at each step, its first child that has any children of its own (or the only child),
 * down to a leaf, at most {@code max} long
 */
export function chainFrom(bone: string, childrenOf: (name: string) => readonly string[], max = 12): string[] {
    const out = [bone];

    while (out.length < max) {
        const kids = childrenOf(out[out.length - 1]);

        if (kids.length === 0) break;

        out.push(kids.find(k => childrenOf(k).length > 0) ?? kids[0]);
    }

    return out;
}

/** Applies a look from {@link LOOKS} to controls */
export function withLook(base: PartControls, look: string): PartControls {
    return { ...base, ...(LOOKS[look]?.controls ?? {}) };
}

// ---------------- colliders ----------------

export function setAutoColliders(doc: Doc, enabled: boolean | null): Doc {
    const next: Doc = { ...doc };

    if (enabled === null) delete next.autoColliders;
    else next.autoColliders = enabled;

    return next;
}

export function autoCollidersOf(doc: Doc): boolean | null {
    const a = doc.autoColliders;

    if (typeof a === 'boolean') return a;

    return typeof a === 'object' && a !== null && typeof a.enabled === 'boolean' ? a.enabled : null;
}

/** Adds an authored collider to a bone, sized roughly like {@code size} (model units) */
export function addCollider(doc: Doc, bone: string, shape: ColliderSpec['shape'], centre: V3, size: number): Doc {
    const next: Doc = { ...doc, colliders: [...(doc.colliders ?? [])] };
    const r = round(size / 2, 2);

    if (shape === 'sphere') next.colliders.push({ bone, shape, center: centre, radius: r, layer: 'body' });
    else if (shape === 'capsule') next.colliders.push({ bone, shape, from: [centre[0], centre[1] + size / 2, centre[2]], to: [centre[0], centre[1] - size / 2, centre[2]], radius: round(size / 4, 2), layer: 'body' });
    else next.colliders.push({ bone, shape, center: centre, size: [size, size, size], layer: 'body' });

    return next;
}

export function removeColliders(doc: Doc, bone: string): Doc {
    return { ...doc, colliders: (doc.colliders ?? []).filter((c: any) => c.bone !== bone) };
}

/** A one-line description of what the document holds, for the panel header */
export function summarise(doc: Doc): string {
    const bones = Object.keys(doc.bones ?? {}).length;
    const chains = Object.keys(doc.chains ?? {}).length;
    const colliders = (doc.colliders ?? []).length;
    const soft = Object.keys(doc.cloth ?? {}).length + Object.keys(doc.flesh ?? {}).length + Object.keys(doc.soft ?? {}).length;

    return `${bones} spring bone${bones === 1 ? '' : 's'}, ${chains} chain${chains === 1 ? '' : 's'}, ${soft > 0 ? `${soft} cloth or flesh, ` : ''}${colliders} collider${colliders === 1 ? '' : 's'}`;
}

// ---------------- cloth and flesh ----------------

/** What the controls show for one cloth or flesh part: the vertices of the bone's meshes, simulated */
export interface SoftControls {
    /** How firmly each edge keeps its length, 0 stretchy to 1 not at all */
    stiffness: number;
    /** How much a fold resists: 0 silk, 1 card */
    bend: number;
    damping: number;
    /** 0 carried rigidly with the model, 1 stays where it was */
    inertia: number;
    gravity: number;
    radius: number;
    /** Cloth: the share of the mesh height, from the top, sewn to the bone */
    pinHeight: number;
    /** How firmly it is pulled back to the animated shape, per second */
    anchor: number;
    weight: number;
    friction: number;
    /** How much a closed mesh keeps its volume */
    volume: number;
    /** The soft zone: middle in blocks and radius; radius 0 for no zone (all of it soft) */
    softCenter: V3;
    softRadius: number;
    iterations: number;
    collideBody: boolean;
    collideWorld: boolean;
    collideOthers: boolean;
    /** Other bones whose meshes ride on this one (a tip on a pouch) */
    carry: string[];
}

export function softControls(doc: Doc, bone: string, kind: 'cloth'): SoftControls {
    const entry = (doc[kind]?.[bone] ?? { bone }) as Record<string, any>;
    const p = resolveCloth(entry, false);

    return {
        stiffness: p.stiffness, bend: p.bend, damping: p.damping, inertia: p.inertia, gravity: p.gravity, radius: p.radius, pinHeight: p.pinHeight, anchor: p.anchor,
        weight: p.weight, friction: p.friction, volume: p.volume, softCenter: p.softCenter ?? [0, 0, 0], softRadius: p.softRadius, iterations: p.iterations,
        collideBody: p.collidesWith.includes('body'), collideWorld: p.collidesWith.includes('world'),
        collideOthers: p.collidesWith.includes('other') || p.collidesWith.includes('players'), carry: [...p.carry],
    };
}

/** Ready-made looks for cloth, one click each; they set the controls, which then stay editable */
export const SOFT_LOOKS: Record<string, { label: string; kind: 'cloth'; preset: string }> = {
    cloth: { label: 'Cloth', kind: 'cloth', preset: 'cloth' },
    'cloth-silk': { label: 'Silk', kind: 'cloth', preset: 'cloth-silk' },
    'cloth-stiff': { label: 'Stiff cloth', kind: 'cloth', preset: 'cloth-stiff' },
};

/** The controls a look means for a bone: the kind's defaults with the preset's numbers over them */
export function softLook(look: string, bone: string): SoftControls {
    const l = SOFT_LOOKS[look];

    return softControls({ [l.kind]: { [bone]: { bone, preset: l.preset } } }, bone, l.kind);
}

/** The preset values, for tests and the panel's hints */
export const SOFT_PRESETS = { cloth: CLOTH_PRESET_VALUES };

/** Makes {@code bone} cloth with these controls (keys the entry already had that the controls do not cover, such as {@code mesh}, are kept) */
export function setSoft(doc: Doc, bone: string, kind: 'cloth', c: SoftControls): Doc {
    const other = 'flesh';
    const next: Doc = { ...doc, [kind]: { ...(doc[kind] ?? {}) } };
    const old = (next[kind][bone] ?? {}) as Record<string, any>;
    const layers: string[] = [];

    if (c.collideBody) layers.push('body');
    if (c.collideWorld) layers.push('world');
    if (c.collideOthers) layers.push('other', 'players', 'mobs');

    const rest = { ...old };

    delete rest.preset;

    const entry: Record<string, any> = {
        ...rest, bone, stiffness: round(c.stiffness), bend: round(c.bend), damping: round(c.damping, 2), inertia: round(c.inertia), gravity: round(c.gravity, 2),
        radius: round(c.radius), anchor: round(c.anchor, 2), weight: round(c.weight), friction: round(c.friction), iterations: Math.round(c.iterations),
        collidesWith: layers,
    };

    entry.pinHeight = round(c.pinHeight);

    if (c.softRadius > 0) {
        entry.softRadius = round(c.softRadius);
        entry.softCenter = c.softCenter.map(v => round(v)) as V3;
    }
    else {
        delete entry.softRadius;
        delete entry.softCenter;
    }

    if (c.carry.length > 0) entry.carry = [...c.carry];
    else delete entry.carry;

    next[kind][bone] = entry;

    if (next[other]) {
        next[other] = { ...next[other] };
        delete next[other][bone];

        if (Object.keys(next[other]).length === 0) delete next[other];
    }

    return next;
}

// ---------------- flesh ----------------

/** What the controls show for one flesh: a cage fitted to the bone's mesh that swings, lags and keeps its volume */
export interface FleshControls {
    /** The look: one of the presets */
    preset: string;
    /** 1 is the preset; more is softer and slower, less firmer */
    softness: number;
    /** The farthest the flesh moves from where the animation puts it, blocks */
    limit: number;
    /** A frequency scale: more is quicker and tighter */
    firmness: number;
    /** How heavy and fleshy it feels: damped more, sagging more, a dent fading slowly */
    meat: number;
    /** How much of the volume pressed in swells out elsewhere */
    bulge: number;
    /** How much the swing stretches it, keeping its volume */
    volume: number;
    weight: number;
    /** The swing's damping ratio, and the nodes': below 1 it wobbles */
    lumpDamping: number;
    nodeDamping: number;
    /** How much the whole swings with the body's motion */
    inertia: number;
    /** How much the swing turns about the pivot rather than sliding */
    rigid: number;
    softCenter: V3;
    softRadius: number;
    carry: string[];
    collideBody: boolean;
    collideWorld: boolean;
    collideOthers: boolean;
    /** The bones of the flesh: one, or two for a pair that presses on each other */
    bones: string[];
    /** The meshes on bones under the root are soft like the root's, rather than riding on it */
    nestedSoft: boolean;
    /** What the swing turns about: the root bone's own pivot, the base of the fitted cage, or a point in the bone's space (blocks) */
    pivotMode: 'bone' | 'auto' | 'custom';
    pivot: V3;
    /** The free end and the side it hangs from: "auto" or an axis of the root bone ("+z", "-y") */
    tip: string;
    up: string;
    /** The model's own bones that press into it (names may start or end with *) */
    presses: string[];
    reach: number;
    lumpShare: number;
    sideStiffness: number;
    stiffen: number;
    anchorFrom: number;
    anchorHold: number;
    anchorFull: number;
    shapeSoftness: number;
    shape: number;
    link: number;
    gravity: number;
    squeezeIn: number;
    squeezeOut: number;
    squeezeStiffness: number;
    rim: number;
    rise: number;
    sway: number;
    turn: number;
    dressedStiffness: number;
    dressedLimit: number;
    dressedCouple: number;
}

/** The numbers of a flesh the panel has beyond the main ones, by the key they are written under (flat), and the group and name they may also be found under */
export const FLESH_EXTRA: { key: keyof FleshControls & string; group?: string; inner?: string }[] = [
    { key: 'reach' }, { key: 'lumpShare', group: 'lump', inner: 'share' }, { key: 'sideStiffness', group: 'lump', inner: 'side' }, { key: 'stiffen', group: 'lump', inner: 'stiffen' },
    { key: 'anchorFrom', group: 'anchor', inner: 'from' }, { key: 'anchorHold', group: 'anchor', inner: 'hold' }, { key: 'anchorFull', group: 'anchor', inner: 'full' },
    { key: 'shapeSoftness' }, { key: 'shape', group: 'node', inner: 'shape' }, { key: 'link', group: 'node', inner: 'link' }, { key: 'gravity', group: 'node', inner: 'gravity' },
    { key: 'squeezeIn', group: 'squeeze', inner: 'in' }, { key: 'squeezeOut', group: 'squeeze', inner: 'out' }, { key: 'squeezeStiffness', group: 'squeeze', inner: 'k' },
    { key: 'rim', group: 'squeeze', inner: 'rim' }, { key: 'rise', group: 'step', inner: 'rise' }, { key: 'sway', group: 'step', inner: 'sway' }, { key: 'turn' },
    { key: 'dressedStiffness', group: 'dressed', inner: 'stiff' }, { key: 'dressedLimit', group: 'dressed', inner: 'limit' }, { key: 'dressedCouple', group: 'dressed', inner: 'couple' },
];

/** An axis as the file writes it: "+z", "-y", or "auto" when it is not one of the six */
export function axisName(v: V3 | null): string {
    if (!v) return 'auto';

    for (let a = 0; a < 3; a++) {
        if (Math.abs(Math.abs(v[a]) - 1) < 1e-6 && v.every((x, i) => i === a || Math.abs(x) < 1e-6)) return `${v[a] < 0 ? '-' : '+'}${'xyz'[a]}`;
    }

    return 'auto';
}

/** The name of the flesh entry that has {@code bone} as its bone (or one of its pair), or null; an entry named for the bone comes first */
export function fleshEntryName(doc: Doc, bone: string): string | null {
    const all: Record<string, any> = { ...(doc.soft ?? {}), ...(doc.flesh ?? {}) };

    if (all[bone] && typeof all[bone] === 'object') return bone;

    for (const [name, entry] of Object.entries(all)) {
        const e = entry as Record<string, any>;

        if (e && (e.bone === bone || (Array.isArray(e.bones) && e.bones.map(String).includes(bone)))) return name;
    }

    return null;
}

export const FLESH_LOOKS: Record<string, string> = {
    pouch: 'Pouch', seat: 'Seat', belly: 'Belly', thigh: 'Thigh', jelly: 'Jelly', 'flesh-soft': 'Soft flesh', 'flesh-firm': 'Firm flesh',
};

export function fleshControls(doc: Doc, bone: string): FleshControls {
    const name = fleshEntryName(doc, bone);
    const entry = (name ? { ...(doc.soft ?? {}), ...(doc.flesh ?? {}) }[name] : { bone }) as Record<string, any>;
    // read without the meat's own scaling of the damping, so the sliders show what the file says
    return fleshControlsOf(resolveFlesh({ bone, ...entry }, [], 'flesh', false), typeof entry.preset === 'string' ? entry.preset : 'pouch');
}

/** The controls for a resolved flesh */
function fleshControlsOf(p: ReturnType<typeof resolveFlesh>, preset: string): FleshControls {
    return {
        preset, softness: p.softness, limit: p.limit, firmness: p.firmness, meat: p.meat, bulge: p.bulge, volume: p.volume,
        weight: p.weight, lumpDamping: p.lumpDamping, nodeDamping: p.nodeDamping, inertia: p.inertia, rigid: p.rigid, softCenter: p.softCenter ?? [0, 0, 0],
        softRadius: p.softRadius, carry: [...p.carry], collideBody: p.collidesWith.includes('body'), collideWorld: p.collidesWith.includes('world'),
        collideOthers: p.collidesWith.includes('other') || p.collidesWith.includes('players'),
        bones: [...p.bones], nestedSoft: p.nestedSoft, pivotMode: p.pivot ? 'custom' : p.bonePivot ? 'bone' : 'auto', pivot: p.pivot ?? [0, 0, 0], tip: axisName(p.tip), up: axisName(p.up),
        presses: [...p.presses], reach: p.reach, lumpShare: p.lumpShare, sideStiffness: p.sideStiffness, stiffen: p.stiffen, anchorFrom: p.anchorFrom, anchorHold: p.anchorHold,
        anchorFull: p.anchorFull, shapeSoftness: p.shapeSoftness, shape: p.shape, link: p.link, gravity: p.gravity, squeezeIn: p.squeezeIn, squeezeOut: p.squeezeOut,
        squeezeStiffness: p.squeezeStiffness, rim: p.rim, rise: p.rise, sway: p.sway, turn: p.turn, dressedStiffness: p.dressedStiffness, dressedLimit: p.dressedLimit,
        dressedCouple: p.dressedCouple,
    };
}

/** The controls a look means for a bone: the preset's numbers over the defaults */
export function fleshLook(look: string, bone: string): FleshControls {
    return fleshControls({ flesh: { [bone]: { bone, preset: look } } }, bone);
}

/** Makes {@code bone} flesh with these controls (keys the entry already had that the controls do not cover, such as a pair of bones or the tip axis, are kept) */
export function setFlesh(doc: Doc, bone: string, c: FleshControls): Doc {
    const name = fleshEntryName(doc, bone) ?? bone;
    const next: Doc = { ...doc, flesh: { ...(doc.flesh ?? {}) } };
    const old = ({ ...(doc.soft ?? {}), ...(doc.flesh ?? {}) }[name] ?? {}) as Record<string, any>;
    const layers: string[] = [];

    if (c.collideBody) layers.push('body');
    if (c.collideWorld) layers.push('world');
    if (c.collideOthers) layers.push('other', 'players', 'mobs');

    const rest = { ...old };

    // the keys of the old per-vertex flesh mean nothing now, and these are written as the cage's own
    for (const key of ['stiffness', 'bend', 'damping', 'gravity', 'radius', 'anchor', 'friction', 'iterations', 'maxParticles', 'pinHeight', 'mesh']) {
        if (typeof rest[key] !== 'object') delete rest[key];
    }

    delete rest.inertia;
    delete rest.lumpDamping;
    delete rest.nodeDamping;

    const entry: Record<string, any> = {
        ...rest, ...(old.bones ? {} : { bone }), preset: c.preset, softness: round(c.softness), limit: round(c.limit, 3), firmness: round(c.firmness), meat: round(c.meat),
        bulge: round(c.bulge), volume: round(c.volume), weight: round(c.weight), rigid: round(c.rigid),
        lump: { ...(typeof old.lump === 'object' ? old.lump : {}), damping: round(c.lumpDamping, 3), inertia: round(c.inertia) },
        node: { ...(typeof old.node === 'object' ? old.node : {}), damping: round(c.nodeDamping, 3) },
        collidesWith: layers,
    };

    if (c.softRadius > 0) {
        entry.softRadius = round(c.softRadius);
        entry.softCenter = c.softCenter.map(v => round(v)) as V3;
    }
    else {
        delete entry.softRadius;
        delete entry.softCenter;
    }

    if (c.carry.length > 0) entry.carry = [...c.carry];
    else delete entry.carry;

    // what the panel has beyond the main numbers is written only when it differs from the look, so the file stays short and a look still means something
    const base = fleshControlsOf(resolveFlesh({ bone, preset: c.preset }, [], 'flesh', false), c.preset);

    for (const { key, group, inner } of FLESH_EXTRA) {
        const grouped = group ? entry[group] : undefined;

        if (group && inner && grouped && typeof grouped === 'object' && !Array.isArray(grouped)) {
            entry[group] = { ...grouped };
            delete entry[group][inner];

            if (Object.keys(entry[group]).length === 0) delete entry[group];
        }

        const value = c[key] as number;

        if (Math.abs(value - (base[key] as number)) > 1e-5) entry[key] = round(value, 4);
        else delete entry[key];
    }

    if (c.tip !== 'auto') entry.tip = c.tip;
    else delete entry.tip;

    if (c.up !== 'auto') entry.up = c.up;
    else delete entry.up;

    if (c.pivotMode === 'custom') entry.pivot = c.pivot.map(v => round(v)) as V3;
    else if (c.pivotMode === 'auto') entry.pivot = 'auto';
    else delete entry.pivot;

    if (c.nestedSoft) entry.nested = 'soft';
    else delete entry.nested;

    if (c.presses.join('|') !== base.presses.join('|')) entry.presses = [...c.presses];
    else delete entry.presses;

    next.flesh[name] = entry;

    // the old name of the section is read as this one: the entry is not kept twice
    if (next.soft) {
        next.soft = { ...next.soft };
        delete next.soft[name];

        if (Object.keys(next.soft).length === 0) delete next.soft;
    }

    if (next.cloth) {
        next.cloth = { ...next.cloth };
        delete next.cloth[bone];

        if (Object.keys(next.cloth).length === 0) delete next.cloth;
    }

    return next;
}

/** The presets a flesh may name, for the panel */
export const FLESH_PRESET_NAMES = Object.keys(FLESH_PRESETS);

/** Names the bones of a flesh: one bone, or two (a pair that presses on each other). The rest of the entry stays */
export function setFleshBones(doc: Doc, bone: string, bones: string[]): Doc {
    const name = fleshEntryName(doc, bone);

    if (name === null || bones.length === 0) return doc;

    const section = doc.flesh?.[name] ? 'flesh' : 'soft';
    const entry: Record<string, any> = { ...doc[section][name] };

    if (bones.length > 1) {
        entry.bones = bones.slice(0, 2);
        delete entry.bone;
    }
    else {
        entry.bone = bones[0];
        delete entry.bones;
    }

    return { ...doc, [section]: { ...doc[section], [name]: entry } };
}
