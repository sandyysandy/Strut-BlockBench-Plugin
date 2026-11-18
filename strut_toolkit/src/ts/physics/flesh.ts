/**
 * Flesh in the plugin: the TypeScript twin of the game's {@code FleshParams}, {@code FleshCageGeometry}, {@code FleshCage} and {@code FleshSolver} (and the
 * vertex blend of {@code FleshInstance}). A region is a small cage of 163 nodes fitted to a mesh, that the animation carries and that swings as one lump, lags
 * node by node, is pulled back toward its shape and keeps its links; every vertex follows the cage. What presses on it, and the floor, are left out: the preview
 * shows the jiggle. The numbers are held to the Java ones by a golden record (tests/fixtures/flesh.json)
 */
import type { V3 } from './math';
import { Placed, pushOut } from './solvers';

const f = Math.fround;

export const STEP = 1 / 60;
const OMEGA_MAX = 18 * Math.PI;
const HELD = 0.95;
const ACCELERATION_CAP = 80;
const SQUEEZE_MAX = 0.09375;
/** How far outside a pressing shape a node counts as touching it, blocks */
const PRESS_SKIN = 0.005;

// ---------------- parameters ----------------

export interface FleshParams {
    bones: string[];
    softness: number; shapeSoftness: number; limit: number; reach: number; tip: V3 | null; up: V3 | null;
    anchorFrom: number; anchorHold: number; anchorFull: number; depthFrom: number; depthTo: number;
    lumpDamping: number; inertia: number; lumpShare: number; sideStiffness: number; stiffen: number; firmness: number;
    nodeDamping: number; shape: number; link: number; gravity: number;
    squeezeIn: number; squeezeOut: number; squeezeStiffness: number; rim: number;
    volume: number; bulge: number; rigid: number; rise: number; sway: number; turn: number;
    dressedStiffness: number; dressedLimit: number; dressedCouple: number;
    collidesWith: string[]; presses: string[]; weight: number;
    softCenter: V3 | null; softRadius: number; carry: string[];
    meat: number; bonePivot: boolean; pivot: V3 | null;
    /** The meshes on bones under a root that has meshes of its own are soft like the root's, rather than rigid riders (a tip on a pouch) */
    nestedSoft: boolean;
}

/** The presets, as the game reads them: what each changes from the defaults */
export const FLESH_PRESETS: Record<string, Record<string, any>> = {
    pouch: {},
    seat: { anchorFrom: 0.55, reach: 0.8, shapeSoftness: 0.75, firmness: 1.1547, volume: 0.4, rim: 0.3 },
    belly: { anchorFrom: 0.55, limit: 0.1, firmness: 1.3, volume: 0.3, rigid: 0.5, rim: 0, rise: 0.03 },
    thigh: { anchorFrom: 0.5, limit: 0.08, firmness: 1.5, volume: 0.2, rigid: 0.3, rim: 0, rise: 0.02 },
    'flesh-soft': { softness: 1.3, volume: 0.6 },
    'flesh-firm': { softness: 0.7, firmness: 1.4, limit: 0.1, volume: 0.4 },
    jelly: { limit: 0.25, firmness: 0.8, lumpDamping: 0.12, nodeDamping: 0.2, volume: 0.8, meat: 0 },
};

/** The keys of the old per-vertex flesh that mean nothing to the cage */
export const OLD_FLESH_KEYS = ['stiffness', 'bend', 'damping', 'inertia', 'gravity', 'anchor', 'radius', 'friction', 'iterations', 'maxParticles', 'pinHeight', 'mesh'];

const GROUPS: Record<string, Record<string, string>> = {
    anchor: { from: 'anchorFrom', hold: 'anchorHold', full: 'anchorFull', depth: 'depth' },
    lump: { damping: 'lumpDamping', inertia: 'inertia', inert: 'inertia', share: 'lumpShare', side: 'sideStiffness', stiffen: 'stiffen' },
    node: { damping: 'nodeDamping', shape: 'shape', link: 'link', gravity: 'gravity' },
    squeeze: { in: 'squeezeIn', out: 'squeezeOut', k: 'squeezeStiffness', rim: 'rim' },
    step: { rise: 'rise', sway: 'sway' },
    dressed: { stiff: 'dressedStiffness', limit: 'dressedLimit', couple: 'dressedCouple' },
};

/** Every key a flesh entry may have, flat or grouped, for the checker */
export const FLESH_KEYS = ['bones', 'bone', 'preset', 'collideBones', 'ignoreBones', 'softness', 'shapeSoftness', 'limit', 'reach', 'tip', 'up', 'anchorFrom', 'anchorHold',
    'anchorFull', 'depth', 'lumpDamping', 'inertia', 'lumpShare', 'sideStiffness', 'stiffen', 'firmness', 'nodeDamping', 'shape', 'link', 'gravity', 'squeezeIn', 'squeezeOut',
    'squeezeStiffness', 'rim', 'volume', 'pivot', 'meat', 'bulge', 'rigid', 'rise', 'sway', 'turn', 'dressedStiffness', 'dressedLimit', 'dressedCouple', 'weight',
    'softCenter', 'softRadius', 'carry', 'nested', 'collidesWith', 'presses', ...Object.keys(GROUPS)];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** {@code "auto"} (null), {@code "+z"}, {@code "-y"} and the like, or {@code [x, y, z]} */
export function parseAxis(value: unknown): V3 | null {
    if (Array.isArray(value)) return [f(Number(value[0])), f(Number(value[1])), f(Number(value[2]))];

    const text = String(value).trim().toLowerCase();

    if (text === 'auto') return null;

    if (text.length !== 2 || (text[0] !== '+' && text[0] !== '-') || 'xyz'.indexOf(text[1]) < 0) throw new Error(`not an axis: ${text} (auto, +x, -x, +y, -y, +z, -z)`);

    const out: V3 = [0, 0, 0];

    out['xyz'.indexOf(text[1])] = text[0] === '-' ? -1 : 1;

    return out;
}

/** What a flesh entry means, the way the game reads it: defaults, then the preset, then the entry's own keys (grouped ones flattened), then meat. {@code warnings} gets what was wrong */
export function resolveFlesh(entry: Record<string, any>, warnings: string[] = [], where = 'flesh', applyMeat = true): FleshParams {
    const bones: string[] = Array.isArray(entry.bones) ? entry.bones.map(String) : entry.bone !== undefined ? [String(entry.bone)] : [];
    const presetName = typeof entry.preset === 'string' ? entry.preset : 'pouch';
    const merged: Record<string, any> = {};

    if (FLESH_PRESETS[presetName]) Object.assign(merged, FLESH_PRESETS[presetName]);
    else warnings.push(`${where}: unknown soft preset "${presetName}" (known: ${Object.keys(FLESH_PRESETS).join(', ')})`);

    const old: string[] = [];

    for (const [key, value] of Object.entries(entry)) {
        if (OLD_FLESH_KEYS.includes(key) && !(typeof value === 'object' && value !== null && !Array.isArray(value))) {
            old.push(key);

            continue;
        }

        const group = GROUPS[key];

        if (!group || typeof value !== 'object' || value === null || Array.isArray(value)) {
            merged[key] = value;

            continue;
        }

        for (const [inner, v] of Object.entries(value as Record<string, any>)) {
            if (group[inner] === undefined) warnings.push(`${where}: unknown key "${key}.${inner}"`);
            else merged[group[inner]] = v;
        }
    }

    const p: FleshParams = {
        bones, softness: 1, shapeSoftness: NaN, limit: 0.15625, reach: 1, tip: null, up: null, anchorFrom: 0.65, anchorHold: 0.75, anchorFull: 0.9, depthFrom: 0.35, depthTo: 0.75,
        lumpDamping: 0.18, inertia: 1.3, lumpShare: 0.7, sideStiffness: 2, stiffen: 0.8, firmness: 1, nodeDamping: 0.3, shape: 0.12, link: 0.08, gravity: 0.00272,
        squeezeIn: 0.8, squeezeOut: 5, squeezeStiffness: 2.5, rim: 0.7, volume: 0.6, bulge: 0.6, rigid: 1, rise: 0.05, sway: 0.2, turn: 1,
        dressedStiffness: 1.5, dressedLimit: 0.8, dressedCouple: 0.25, collidesWith: ['body', 'other', 'players', 'mobs', 'world'],
        presses: ['steve*', 'arm*', 'lowerArm*', 'forearm*', 'hand*'], weight: 1, softCenter: null, softRadius: 0, carry: [], meat: 0.5, bonePivot: true, pivot: null, nestedSoft: false,
    };

    for (const [key, v] of Object.entries(merged)) {
        try {
            switch (key) {
                case 'bones': case 'bone': case 'preset': case 'collideBones': case 'ignoreBones': break;
                case 'softness': p.softness = f(Math.max(0.1, Number(v))); break;
                case 'shapeSoftness': p.shapeSoftness = f(Math.max(0.1, Number(v))); break;
                case 'limit': p.limit = f(Math.max(0, Number(v))); break;
                case 'reach': p.reach = f(clamp01(Number(v))); break;
                case 'tip': p.tip = parseAxis(v); break;
                case 'up': p.up = parseAxis(v); break;
                case 'anchorFrom': p.anchorFrom = f(clamp01(Number(v))); break;
                case 'anchorHold': p.anchorHold = f(clamp01(Number(v))); break;
                case 'anchorFull': p.anchorFull = f(clamp01(Number(v))); break;
                case 'depth': p.depthFrom = f(clamp01(Number(v[0]))); p.depthTo = f(clamp01(Number(v[1]))); break;
                case 'lumpDamping': p.lumpDamping = f(Math.max(0, Number(v))); break;
                case 'inertia': p.inertia = f(Math.max(0, Number(v))); break;
                case 'lumpShare': p.lumpShare = f(clamp01(Number(v))); break;
                case 'sideStiffness': p.sideStiffness = f(Math.max(0.1, Number(v))); break;
                case 'stiffen': p.stiffen = f(Math.max(0.05, Number(v))); break;
                case 'firmness': p.firmness = f(Math.max(0.05, Number(v))); break;
                case 'nodeDamping': p.nodeDamping = f(Math.max(0, Number(v))); break;
                case 'shape': p.shape = f(clamp01(Number(v))); break;
                case 'link': p.link = f(clamp01(Number(v))); break;
                case 'gravity': p.gravity = f(Number(v)); break;
                case 'squeezeIn': p.squeezeIn = f(Math.max(0.01, Number(v))); break;
                case 'squeezeOut': p.squeezeOut = f(Math.max(0.01, Number(v))); break;
                case 'squeezeStiffness': p.squeezeStiffness = f(Math.max(0, Number(v))); break;
                case 'rim': p.rim = f(Math.max(0, Number(v))); break;
                case 'volume': p.volume = f(Math.max(0, Number(v))); break;
                case 'pivot':
                    if (Array.isArray(v)) {
                        p.pivot = parseAxis(v);
                    }
                    else {
                        const text = String(v).trim().toLowerCase();

                        if (text !== 'bone' && text !== 'auto') throw new Error(`not a pivot: ${text} (bone, auto, or [x, y, z])`);

                        p.bonePivot = text === 'bone';
                    }

                    break;
                case 'meat': p.meat = f(Math.max(0, Math.min(2, Number(v)))); break;
                case 'bulge': p.bulge = f(Math.max(0, Number(v))); break;
                case 'rigid': p.rigid = f(Math.max(0, Number(v))); break;
                case 'rise': p.rise = f(Math.max(0, Number(v))); break;
                case 'sway': p.sway = f(Math.max(0, Number(v))); break;
                case 'turn': p.turn = f(Math.max(0, Number(v))); break;
                case 'dressedStiffness': p.dressedStiffness = f(Math.max(0.1, Number(v))); break;
                case 'dressedLimit': p.dressedLimit = f(clamp01(Number(v))); break;
                case 'dressedCouple': p.dressedCouple = f(clamp01(Number(v))); break;
                case 'weight': p.weight = f(clamp01(Number(v))); break;
                case 'softCenter': p.softCenter = [f(Number(v[0])), f(Number(v[1])), f(Number(v[2]))]; break;
                case 'softRadius': p.softRadius = f(Math.max(0, Number(v))); break;
                case 'carry': p.carry = (v as unknown[]).map(String); break;
                case 'nested': {
                    const text = String(v).trim().toLowerCase();

                    if (text !== 'soft' && text !== 'rigid') throw new Error(`not a choice: ${text} (soft or rigid)`);

                    p.nestedSoft = text === 'soft';
                    break;
                }
                case 'collidesWith': p.collidesWith = (v as unknown[]).map(String); break;
                case 'presses': p.presses = (v as unknown[]).map(String); break;
                default: warnings.push(`${where}: unknown key "${key}"`);
            }
        }
        catch (e) {
            warnings.push(`${where}: "${key}" has a value that cannot be read (${(e as Error).message})`);
        }
    }

    if (Number.isNaN(p.shapeSoftness)) p.shapeSoftness = p.softness;

    // meat: heavier, so a swing dies away sooner and sags more (the editor reads the numbers without it, so it does not count twice)
    if (applyMeat) {
        p.lumpDamping = f(p.lumpDamping * f(1 + f(0.8 * p.meat)));
        p.nodeDamping = f(p.nodeDamping * f(1 + f(0.8 * p.meat)));
        p.gravity = f(p.gravity * f(1 + f(0.5 * p.meat)));
    }

    if (old.length > 0) warnings.push(`${where}: ${old.join(', ')} were for the old per-vertex flesh and do nothing now; the cage moves it (see softness, limit, firmness, lump, node)`);

    return p;
}

// ---------------- the cage's shape ----------------

export const SURFACE = 162;
export const NODES = SURFACE + 1;
export const CENTRE = SURFACE;
const CELLS = 12;
const LOOKUP_REACH = 0.58;

const unit = (x: number, y: number, z: number): V3 => {
    const l = Math.sqrt(x * x + y * y + z * z);

    return [x / l, y / l, z / l];
};

export class FleshGeometry {
    private static instance: FleshGeometry | null = null;

    readonly dir = new Float64Array(SURFACE * 3);
    readonly linkA: number[];
    readonly linkB: number[];
    readonly neighbours: number[][] = [];
    readonly faces: number[];
    private readonly cells: number[][];

    static get(): FleshGeometry {
        if (!FleshGeometry.instance) FleshGeometry.instance = new FleshGeometry();

        return FleshGeometry.instance;
    }

    private constructor() {
        const points: V3[] = [];
        const t = (1 + Math.sqrt(5)) / 2;
        const base: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];

        for (const p of base) points.push(unit(p[0], p[1], p[2]));

        let faces: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2],
            [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

        for (let level = 0; level < 2; level++) {
            const middles = new Map<number, number>();
            const middle = (p: number, q: number): number => {
                const key = Math.min(p, q) * 100000 + Math.max(p, q);
                const known = middles.get(key);

                if (known !== undefined) return known;

                const a = points[p];
                const b = points[q];

                points.push(unit(a[0] + b[0], a[1] + b[1], a[2] + b[2]));
                middles.set(key, points.length - 1);

                return points.length - 1;
            };
            const split: number[][] = [];

            for (const face of faces) {
                const ab = middle(face[0], face[1]);
                const bc = middle(face[1], face[2]);
                const ca = middle(face[2], face[0]);

                split.push([face[0], ab, ca], [face[1], bc, ab], [face[2], ca, bc], [ab, bc, ca]);
            }

            faces = split;
        }

        for (let i = 0; i < SURFACE; i++) for (let a = 0; a < 3; a++) this.dir[i * 3 + a] = points[i][a];

        this.faces = [];

        for (const face of faces) {
            const a = points[face[0]];
            const b = points[face[1]];
            const c = points[face[2]];
            const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
            const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            const outward = nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1]) + nz * (a[2] + b[2] + c[2]) > 0;

            this.faces.push(face[0], outward ? face[1] : face[2], outward ? face[2] : face[1]);
        }

        const seen = new Set<number>();
        const a: number[] = [];
        const b: number[] = [];
        const around: number[][] = [];

        for (let i = 0; i < SURFACE; i++) around.push([]);

        for (const face of faces) {
            for (let e = 0; e < 3; e++) {
                const p = face[e];
                const q = face[(e + 1) % 3];
                const key = Math.min(p, q) * 100000 + Math.max(p, q);

                if (seen.has(key)) continue;

                seen.add(key);
                a.push(p);
                b.push(q);
                around[p].push(q);
                around[q].push(p);
            }
        }

        for (let i = 0; i < SURFACE; i++) {
            a.push(CENTRE);
            b.push(i);
        }

        this.linkA = a;
        this.linkB = b;
        this.neighbours = around;
        this.cells = [];

        const reach = Math.cos(LOOKUP_REACH);

        for (let face = 0; face < 6; face++) {
            for (let u = 0; u < CELLS; u++) {
                for (let v = 0; v < CELLS; v++) {
                    const middle = cellDirection(face, (u + 0.5) / CELLS * 2 - 1, (v + 0.5) / CELLS * 2 - 1);
                    const near: number[] = [];

                    for (let i = 0; i < SURFACE; i++) {
                        if (middle[0] * this.dir[i * 3] + middle[1] * this.dir[i * 3 + 1] + middle[2] * this.dir[i * 3 + 2] >= reach) near.push(i);
                    }

                    this.cells[(face * CELLS + u) * CELLS + v] = near;
                }
            }
        }
    }

    /** The surface nodes near the direction (x, y, z), which need not be unit */
    near(x: number, y: number, z: number): number[] {
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        const az = Math.abs(z);
        let face: number;
        let u: number;
        let v: number;

        if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; u = y / ax; v = z / ax; }
        else if (ay >= az) { face = y > 0 ? 2 : 3; u = x / ay; v = z / ay; }
        else { face = z > 0 ? 4 : 5; u = x / az; v = y / az; }

        if (Number.isNaN(u) || Number.isNaN(v)) return this.cells[0];

        const cu = Math.max(0, Math.min(CELLS - 1, Math.trunc((u + 1) * 0.5 * CELLS)));
        const cv = Math.max(0, Math.min(CELLS - 1, Math.trunc((v + 1) * 0.5 * CELLS)));

        return this.cells[(face * CELLS + cu) * CELLS + cv];
    }

    /** The unit normal at each surface node of a cage whose nodes are at {@code points}: the faces around it, each by its area */
    normals(points: ArrayLike<number>, out: Float64Array): void {
        out.fill(0, 0, SURFACE * 3);

        for (let fi = 0; fi < this.faces.length; fi += 3) {
            const a = this.faces[fi] * 3;
            const b = this.faces[fi + 1] * 3;
            const c = this.faces[fi + 2] * 3;
            const ux = points[b] - points[a]; const uy = points[b + 1] - points[a + 1]; const uz = points[b + 2] - points[a + 2];
            const vx = points[c] - points[a]; const vy = points[c + 1] - points[a + 1]; const vz = points[c + 2] - points[a + 2];
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;

            for (let corner = 0; corner < 3; corner++) {
                const at = this.faces[fi + corner] * 3;

                out[at] += nx; out[at + 1] += ny; out[at + 2] += nz;
            }
        }

        for (let i = 0; i < SURFACE; i++) {
            const length = Math.sqrt(out[i * 3] * out[i * 3] + out[i * 3 + 1] * out[i * 3 + 1] + out[i * 3 + 2] * out[i * 3 + 2]);

            if (length > 1e-18) { out[i * 3] /= length; out[i * 3 + 1] /= length; out[i * 3 + 2] /= length; }
        }
    }
}

function cellDirection(face: number, u: number, v: number): V3 {
    switch (face) {
        case 0: return unit(1, u, v);
        case 1: return unit(-1, u, v);
        case 2: return unit(u, 1, v);
        case 3: return unit(u, -1, v);
        case 4: return unit(u, v, 1);
        default: return unit(u, v, -1);
    }
}

const smoothstep = (from: number, to: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - from) / Math.max(1e-9, to - from)));

    return t * t * (3 - 2 * t);
};

// ---------------- the cage fitted to a mesh ----------------

const KERNEL = Math.cos(0.42);
const MOST_NODES = 6;
const FIT = Math.cos(0.3);

export interface Binding {
    start: number[];
    node: number[];
    weight: number[];
    surface: number[];
    softness: number[];
}

export class FleshCage {
    readonly centre: V3 = [0, 0, 0];
    readonly half: V3 = [0, 0, 0];
    readonly radius = new Float64Array(SURFACE);
    readonly rest = new Float64Array(NODES * 3);
    readonly restNormals = new Float64Array(SURFACE * 3);
    readonly anchor = new Float64Array(NODES);
    tip: V3 = [0, 0, 1];
    up: V3 = [0, 1, 0];
    readonly pivot: V3 = [0, 0, 0];
    length = 0;
    limit = 0;

    /**
     * Fits a cage to {@code points}, the vertices of the region's meshes in its own frame, blocks
     *
     * @param toModel The region's frame in the model's space at rest (what says which way is out from the body): the identity when the frame is the model's
     */
    constructor(points: readonly V3[], p: FleshParams, toModel: (v: V3) => V3 = v => v, upInModel: V3 = [0, 1, 0]) {
        const geometry = FleshGeometry.get();
        const n = points.length;

        for (let a = 0; a < 3; a++) {
            const axis = points.map(q => q[a]).sort((x, y) => x - y);
            const lo = axis[Math.min(n - 1, Math.floor(0.03 * (n - 1)))];
            const hi = axis[Math.min(n - 1, Math.ceil(0.97 * (n - 1)))];

            this.centre[a] = (lo + hi) * 0.5;
            this.half[a] = Math.max(1 / 320, (hi - lo) * 0.5);
        }

        let reached = new Array<boolean>(SURFACE).fill(false);

        for (const q of points) {
            const qx = (q[0] - this.centre[0]) / this.half[0];
            const qy = (q[1] - this.centre[1]) / this.half[1];
            const qz = (q[2] - this.centre[2]) / this.half[2];
            const l = Math.sqrt(qx * qx + qy * qy + qz * qz);

            if (l < 1e-9) continue;

            for (const i of geometry.near(qx, qy, qz)) {
                if ((qx * geometry.dir[i * 3] + qy * geometry.dir[i * 3 + 1] + qz * geometry.dir[i * 3 + 2]) / l >= FIT) {
                    this.radius[i] = reached[i] ? Math.max(this.radius[i], l) : l;
                    reached[i] = true;
                }
            }
        }

        for (let pass = 0; pass < 8; pass++) {
            const next = reached.slice();

            for (let i = 0; i < SURFACE; i++) {
                if (reached[i]) continue;

                let sum = 0;
                let count = 0;

                for (const j of geometry.neighbours[i]) {
                    if (reached[j]) { sum += this.radius[j]; count++; }
                }

                if (count > 0) { this.radius[i] = sum / count; next[i] = true; }
            }

            reached = next;
        }

        for (let i = 0; i < SURFACE; i++) if (!reached[i]) this.radius[i] = 1;

        const smooth = new Float64Array(SURFACE);

        for (let i = 0; i < SURFACE; i++) {
            let sum = 0;

            for (const j of geometry.neighbours[i]) sum += this.radius[j];

            smooth[i] = Math.max(0.25, Math.min(1.8, this.radius[i] * 0.7 + sum / geometry.neighbours[i].length * 0.3));
        }

        this.radius.set(smooth);

        for (let i = 0; i < SURFACE; i++) {
            for (let a = 0; a < 3; a++) this.rest[i * 3 + a] = this.centre[a] + this.half[a] * geometry.dir[i * 3 + a] * this.radius[i];
        }

        for (let a = 0; a < 3; a++) this.rest[CENTRE * 3 + a] = this.centre[a];

        geometry.normals(this.rest, this.restNormals);
        this.chooseAxes(p.tip, p.up, toModel, upInModel);

        let front = -Number.MAX_VALUE;
        let back = Number.MAX_VALUE;

        for (let i = 0; i < NODES; i++) {
            const along = this.along(i);

            front = Math.max(front, along);
            back = Math.min(back, along);
        }

        this.length = Math.max(1 / 320, front - back);

        for (let a = 0; a < 3; a++) this.pivot[a] = this.centre[a] + this.tip[a] * back;

        const from = p.anchorFrom;
        const full = Math.max(from + f(0.05), p.anchorFull);

        for (let i = 0; i < NODES; i++) {
            const depth = (front - this.along(i)) / this.length;
            let upward = 0;

            if (i < SURFACE) upward = geometry.dir[i * 3] * this.up[0] + geometry.dir[i * 3 + 1] * this.up[1] + geometry.dir[i * 3 + 2] * this.up[2];

            const hold = p.anchorHold * smoothstep(from, full, Math.abs(upward)) * smoothstep(p.depthFrom, p.depthTo, depth);

            this.anchor[i] = Math.max(depth * depth, hold);

            if (p.softRadius > 0) {
                const zone: V3 = p.softCenter ?? [f(this.centre[0]), f(this.centre[1]), f(this.centre[2])];
                const dx = this.rest[i * 3] - zone[0];
                const dy = this.rest[i * 3 + 1] - zone[1];
                const dz = this.rest[i * 3 + 2] - zone[2];
                const t = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / p.softRadius);

                this.anchor[i] = Math.max(this.anchor[i], t * t * (3 - 2 * t));
            }
        }

        const diagonal = Math.sqrt(this.half[0] * this.half[0] + this.half[1] * this.half[1] + this.half[2] * this.half[2]);

        this.limit = Math.min(diagonal, p.limit) * p.reach;

        // the swing turns about the bone's own pivot, unless it is far from the flesh
        if (p.pivot) {
            this.pivot[0] = p.pivot[0]; this.pivot[1] = p.pivot[1]; this.pivot[2] = p.pivot[2];
        }
    }

    private along(i: number): number {
        return (this.rest[i * 3] - this.centre[0]) * this.tip[0] + (this.rest[i * 3 + 1] - this.centre[1]) * this.tip[1] + (this.rest[i * 3 + 2] - this.centre[2]) * this.tip[2];
    }

    /** The tip is the end of the region farthest out from the middle of the body, unless named; up is the model's up, unless named */
    private chooseAxes(tipAxis: V3 | null, upAxis: V3 | null, toModel: (v: V3) => V3, upInModel: V3): void {
        if (tipAxis) {
            this.tip = setUnit(tipAxis[0], tipAxis[1], tipAxis[2]);
        }
        else {
            const middle = toModel([this.centre[0], this.centre[1], this.centre[2]]);
            let best = -Number.MAX_VALUE;

            for (let a = 0; a < 3; a++) {
                for (let sign = -1; sign <= 1; sign += 2) {
                    const at: V3 = [this.centre[0], this.centre[1], this.centre[2]];

                    at[a] += sign * this.half[a];

                    const end = toModel(at);
                    const out = Math.hypot(end[0], end[2]) - Math.hypot(middle[0], middle[2]);

                    if (out > best) {
                        best = out;
                        this.tip = setUnit(a === 0 ? sign : 0, a === 1 ? sign : 0, a === 2 ? sign : 0);
                    }
                }
            }
        }

        this.up = upAxis ? setUnit(upAxis[0], upAxis[1], upAxis[2]) : setUnit(upInModel[0], upInModel[1], upInModel[2]);
    }

    /** How each of {@code points} (in the region's frame) follows the cage: the surface nodes about its direction, each by how near, and how much it moves with the centre */
    bind(points: readonly V3[]): Binding {
        const geometry = FleshGeometry.get();
        const out: Binding = { start: [], node: [], weight: [], surface: [], softness: [] };

        for (let k = 0; k < points.length; k++) {
            const qx = (points[k][0] - this.centre[0]) / this.half[0];
            const qy = (points[k][1] - this.centre[1]) / this.half[1];
            const qz = (points[k][2] - this.centre[2]) / this.half[2];
            const s = Math.sqrt(qx * qx + qy * qy + qz * qz);

            out.start[k] = out.node.length;

            if (s < 1e-9) {
                out.surface[k] = 0;
                out.softness[k] = 1 - this.anchor[CENTRE];

                continue;
            }

            let sum = 0;
            let reach = 0;
            let soft = 0;
            const from = out.node.length;

            for (const i of geometry.near(qx, qy, qz)) {
                const d = (qx * geometry.dir[i * 3] + qy * geometry.dir[i * 3 + 1] + qz * geometry.dir[i * 3 + 2]) / s;

                if (d <= KERNEL) continue;

                let kernel = (d - KERNEL) / (1 - KERNEL);

                kernel *= kernel;
                out.node.push(i);
                out.weight.push(f(kernel));
                sum += kernel;
                reach += kernel * this.radius[i];
                soft += kernel * (1 - this.anchor[i]);
            }

            if (sum <= 0) {
                let nearest = 0;
                let best = -2;

                for (let i = 0; i < SURFACE; i++) {
                    const d = qx * geometry.dir[i * 3] + qy * geometry.dir[i * 3 + 1] + qz * geometry.dir[i * 3 + 2];

                    if (d > best) { best = d; nearest = i; }
                }

                out.node.push(nearest);
                out.weight.push(1);
                sum = 1;
                reach = this.radius[nearest];
                soft = 1 - this.anchor[nearest];
            }

            while (out.node.length - from > MOST_NODES) {
                let weakest = from;

                for (let j = from + 1; j < out.node.length; j++) if (out.weight[j] < out.weight[weakest]) weakest = j;

                const node = out.node[weakest];
                const w = out.weight[weakest];

                sum -= w;
                reach -= w * this.radius[node];
                soft -= w * (1 - this.anchor[node]);
                out.node.splice(weakest, 1);
                out.weight.splice(weakest, 1);
            }

            for (let j = from; j < out.node.length; j++) out.weight[j] = f(out.weight[j] / sum);

            const t = Math.min(1, s / Math.max(1e-6, reach / sum));

            out.surface[k] = f(t);
            out.softness[k] = f(t * soft / sum + (1 - t) * (1 - this.anchor[CENTRE]));
        }

        out.start[points.length] = out.node.length;

        return out;
    }
}

function setUnit(x: number, y: number, z: number): V3 {
    const l = Math.sqrt(x * x + y * y + z * z);

    return l < 1e-9 ? [0, 1, 0] : [x / l, y / l, z / l];
}

// ---------------- the exact damped spring ----------------

/** Steps one axis by {@code dt}: {@code s[0]} the position and {@code s[1]} the velocity, both replaced (the game's Oscillator) */
export function oscillate(s: number[], a: number, omega: number, zeta: number, dt: number): void {
    const x = s[0];
    const v = s[1];

    if (omega < 1e-6) {
        s[0] = x + v * dt + 0.5 * a * dt * dt;
        s[1] = v + a * dt;

        return;
    }

    const rest = a / (omega * omega);
    const y = x - rest;

    if (zeta < 1 - 1e-6) {
        const wd = omega * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * omega * dt);
        const cos = Math.cos(wd * dt);
        const sin = Math.sin(wd * dt);
        const b = (v + zeta * omega * y) / wd;

        s[0] = decay * (y * cos + b * sin) + rest;
        s[1] = decay * ((b * wd - zeta * omega * y) * cos - (y * wd + zeta * omega * b) * sin);
    }
    else if (zeta <= 1 + 1e-6) {
        const decay = Math.exp(-omega * dt);
        const b = v + omega * y;

        s[0] = (y + b * dt) * decay + rest;
        s[1] = (b - omega * (y + b * dt)) * decay;
    }
    else {
        const root = omega * Math.sqrt(zeta * zeta - 1);
        const r1 = -zeta * omega + root;
        const r2 = -zeta * omega - root;
        const c2 = (v - r1 * y) / (r2 - r1);
        const c1 = y - c2;
        const e1 = Math.exp(r1 * dt);
        const e2 = Math.exp(r2 * dt);

        s[0] = c1 * e1 + c2 * e2 + rest;
        s[1] = c1 * r1 * e1 + c2 * r2 * e2;
    }
}

// ---------------- the solver ----------------

const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const square = (v: number): number => v * v;

/** Rounds half to even, as Java's Math.rint does */
function rint(v: number): number {
    const r = Math.round(v);

    return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function normalise(v: number[]): boolean {
    const length = Math.sqrt(dot3(v, v));

    if (length < 1e-9) return false;

    for (let i = 0; i < 3; i++) v[i] /= length;

    return true;
}

function perpendicular(u: ArrayLike<number>, out: number[]): void {
    const x = Math.abs(u[0]) < 0.9;

    out[0] = x ? 1 : 0;
    out[1] = 0;
    out[2] = x ? 0 : 1;

    const along = dot3(out, u);

    for (let k = 0; k < 3; k++) out[k] -= along * u[k];

    normalise(out);
}

function softClamp(v: ArrayLike<number>, reach: number, out: number[]): void {
    const length = Math.sqrt(dot3(v, v));

    if (length < 1e-12 || reach <= 0) {
        for (let i = 0; i < 3; i++) out[i] = v[i];

        return;
    }

    const k = reach * Math.tanh(length / reach) / length;

    for (let i = 0; i < 3; i++) out[i] = v[i] * k;
}

function determinant(r: number[]): number {
    return r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
}

/** The rotation part of a 3 by 3 matrix (row major) into {@code r}, by averaging it with its inverse transpose until it settles; false when it has none */
function polar(m: number[], r: number[]): boolean {
    let scaleOf = 0;

    for (const v of m) scaleOf = Math.max(scaleOf, Math.abs(v));

    if (scaleOf < 1e-12) return false;

    for (let i = 0; i < 9; i++) r[i] = m[i] / scaleOf;

    const next = new Array<number>(9).fill(0);

    for (let iteration = 0; iteration < 12; iteration++) {
        const det = determinant(r);

        if (!(det > 1e-12)) return false;

        next[0] = (r[4] * r[8] - r[5] * r[7]) / det;
        next[1] = (r[5] * r[6] - r[3] * r[8]) / det;
        next[2] = (r[3] * r[7] - r[4] * r[6]) / det;
        next[3] = (r[2] * r[7] - r[1] * r[8]) / det;
        next[4] = (r[0] * r[8] - r[2] * r[6]) / det;
        next[5] = (r[1] * r[6] - r[0] * r[7]) / det;
        next[6] = (r[1] * r[5] - r[2] * r[4]) / det;
        next[7] = (r[2] * r[3] - r[0] * r[5]) / det;
        next[8] = (r[0] * r[4] - r[1] * r[3]) / det;

        for (let i = 0; i < 9; i++) r[i] = (r[i] + next[i]) * 0.5;
    }

    return true;
}

/** One region's state: the nodes, the lump, and what the last steps measured (world blocks) */
export class FleshRegion {
    readonly x = new Float64Array(NODES * 3);
    readonly target = new Float64Array(NODES * 3);
    private readonly targetBefore = new Float64Array(NODES * 3);
    private readonly ownBefore = new Float64Array(NODES * 3);
    private readonly shift = new Float64Array(NODES * 3);
    private readonly acceleration = new Float64Array(NODES * 3);
    private readonly lagVelocity = new Float64Array(NODES * 3);
    readonly displacement = new Float64Array(NODES * 3);
    private readonly displacementBefore = new Float64Array(NODES * 3);
    private readonly contact = new Float64Array(NODES);
    readonly lump: number[] = [0, 0, 0];
    private readonly lumpVelocity: number[] = [0, 0, 0];
    readonly lumpShown: number[] = [0, 0, 0];
    private readonly lumpShownBefore: number[] = [0, 0, 0];
    private lumpOmega = 0;
    initialised = false;
    readonly up: number[] = [0, 1, 0];
    readonly tipDirection: number[] = [0, 0, 1];
    entityX = 0;
    entityY = 0;
    entityZ = 0;
    softness = 1;
    sizeScale = 1;
    dressed = false;
    legSpeed = 0;
    legPosition = 0;
    animatedHeight = 0;
    private heading = 0;
    private headingRate = 0;
    private headingAcceleration = 0;
    private headingKnown = false;
    private readonly rise = [0, 0, 0];
    private riseAcceleration = 0;
    private readonly sway = [0, 0, 0];
    private swayAcceleration = 0;
    private heightMean = 0;
    private heightSwing = 0;
    private heightKnown = false;
    private readonly linkLength: number[];
    linksStale = true;
    readonly planePoint: number[] = [0, 0, 0];
    readonly planeNormal: number[] = [0, 0, 0];
    planeAllow = 0;
    squeeze = 0;
    paired = false;
    private readonly inward: number[] = [0, 0, 0];
    private readonly force: number[] = [0, 0, 0];
    private readonly inAxis: number[] = [0, 0, 0];
    private readonly side: number[] = [0, 0, 0];
    private readonly result: number[] = [0, 0, 0];
    private readonly velocity: number[] = [0, 0, 0];

    constructor(readonly cage: FleshCage) {
        this.linkLength = new Array<number>(FleshGeometry.get().linkA.length).fill(0);
    }

    /** Snaps every node to its target with no motion: the next step starts from rest */
    reset(): void {
        this.initialised = false;
    }

    limit(p: FleshParams): number {
        return this.cage.limit * (this.dressed ? p.dressedLimit : 1);
    }

    /** Measures the body's acceleration at each node from how its target moved, the turn, and the walk */
    begin(h: number): void {
        const n = NODES;

        this.displacementBefore.set(this.displacement);
        this.lumpShownBefore[0] = this.lumpShown[0]; this.lumpShownBefore[1] = this.lumpShown[1]; this.lumpShownBefore[2] = this.lumpShown[2];

        if (!this.initialised) {
            this.x.set(this.target);
            this.targetBefore.set(this.target);
            this.ownBefore.fill(0);
            this.acceleration.fill(0);
            this.lagVelocity.fill(0);
            this.displacement.fill(0);
            this.displacementBefore.fill(0);
            this.lump.fill(0);
            this.lumpVelocity.fill(0);
            this.lumpShown.fill(0);
            this.lumpShownBefore.fill(0);
            this.rise.fill(0);
            this.sway.fill(0);
            this.riseAcceleration = 0;
            this.swayAcceleration = 0;
            this.headingKnown = false;
            this.heightKnown = false;
            this.initialised = true;
        }

        const smooth = 1 - Math.pow(0.5, h / 0.04);

        for (let i = 0; i < n * 3; i++) {
            const own = this.target[i] - this.targetBefore[i];
            const a = (own - this.ownBefore[i]) / (h * h);

            this.shift[i] = own;
            this.ownBefore[i] = own;
            this.acceleration[i] += (a - this.acceleration[i]) * smooth;
            this.targetBefore[i] = this.target[i];
        }

        for (let i = 0; i < n; i++) {
            const ax = this.acceleration[i * 3];
            const ay = this.acceleration[i * 3 + 1];
            const az = this.acceleration[i * 3 + 2];
            const length = Math.sqrt(ax * ax + ay * ay + az * az);

            if (length > ACCELERATION_CAP) {
                const k = ACCELERATION_CAP / length;

                this.acceleration[i * 3] *= k;
                this.acceleration[i * 3 + 1] *= k;
                this.acceleration[i * 3 + 2] *= k;
            }
        }

        const heading = Math.atan2(this.tipDirection[0], this.tipDirection[2]);
        const turnSmooth = 1 - Math.pow(0.5, h / 0.06);

        if (this.headingKnown) {
            let change = heading - this.heading;

            change -= Math.floor((change + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;

            const before = this.headingRate;

            this.headingRate += (change / h - this.headingRate) * turnSmooth;
            this.headingAcceleration += ((this.headingRate - before) / h - this.headingAcceleration) * turnSmooth;
        }
        else {
            this.headingRate = 0;
            this.headingAcceleration = 0;
        }

        this.heading = heading;
        this.headingKnown = true;

        const settle = 1 - Math.pow(0.5, h / 0.5);

        if (!this.heightKnown) {
            this.heightMean = this.animatedHeight;
            this.heightSwing = 0;
            this.heightKnown = true;
        }

        this.heightMean += (this.animatedHeight - this.heightMean) * settle;
        this.heightSwing += (Math.abs(this.animatedHeight - this.heightMean) - this.heightSwing) * settle;
    }

    /** The rise and the sway of a walk at the legs' place, faded where the animation bobs the region itself */
    gait(p: FleshParams, h: number): void {
        const own = smoothstep(0.0125, 0.03, this.heightSwing);
        const speed = Math.max(0, Math.min(1, this.legSpeed));
        const rise = (1 - own) * p.rise * speed * (1 - Math.cos(1.3324 * this.legPosition)) / 2;
        const sway = (1 - own) * p.sway * speed * Math.sin(0.6662 * this.legPosition);
        const smooth = 1 - Math.pow(0.5, h / 0.04);

        this.rise[2] = this.rise[1]; this.rise[1] = this.rise[0]; this.rise[0] = rise;
        this.sway[2] = this.sway[1]; this.sway[1] = this.sway[0]; this.sway[0] = sway;
        this.riseAcceleration += ((this.rise[0] - 2 * this.rise[1] + this.rise[2]) / (h * h) - this.riseAcceleration) * smooth;
        this.swayAcceleration += ((this.sway[0] - 2 * this.sway[1] + this.sway[2]) / (h * h) - this.swayAcceleration) * smooth;
    }

    reachPast(points: ArrayLike<number>): number {
        let most = -Number.MAX_VALUE;

        for (let i = 0; i < SURFACE; i++) {
            const along = (points[i * 3] - this.planePoint[0]) * this.planeNormal[0] + (points[i * 3 + 1] - this.planePoint[1]) * this.planeNormal[1]
                + (points[i * 3 + 2] - this.planePoint[2]) * this.planeNormal[2];

            most = Math.max(most, along);
        }

        return most;
    }

    /** The swing of the whole region: three springs, along up, toward the other of a pair (or forward), and to the side */
    lumpStep(p: FleshParams, h: number): void {
        const limit = this.limit(p);
        const tip = Math.min(1, 0.05 / Math.max(0.05, this.softness) * this.sizeScale);
        const firm = p.firmness * (this.dressed ? Math.sqrt(p.dressedStiffness) : 1);
        const swing = Math.sqrt(this.lump[0] * this.lump[0] + this.lump[1] * this.lump[1] + this.lump[2] * this.lump[2]);
        const stiffening = Math.sqrt(1 + square(swing / Math.max(1e-6, p.stiffen * limit)));
        const omega = Math.min(OMEGA_MAX, Math.sqrt(tip) / STEP * 0.85 * stiffening * firm);
        const zeta = this.dressed ? Math.max(p.lumpDamping, 0.4) : p.lumpDamping;
        const c = CENTRE * 3;
        const force = this.force;
        const share = p.inertia * p.lumpShare;

        for (let k = 0; k < 3; k++) force[k] = -share * this.acceleration[c + k];

        let tx = this.tipDirection[0];
        let tz = this.tipDirection[2];
        const flat = Math.sqrt(tx * tx + tz * tz);

        if (flat > 1e-6) {
            tx /= flat;
            tz /= flat;

            const sideX = tz;
            const sideZ = -tx;
            const turn = 30 * Math.tanh(this.headingRate / 5) + 0.3 * this.headingAcceleration;
            const lateral = -Math.max(-40, Math.min(40, p.turn * turn));

            force[0] += lateral * sideX + this.swayAcceleration * -sideX;
            force[2] += lateral * sideZ + this.swayAcceleration * -sideZ;

            const spin = 5 * Math.tanh(this.headingRate / 5);
            const rx = this.target[c] - this.entityX;
            const rz = this.target[c + 2] - this.entityZ;

            force[0] += p.turn * spin * spin * rx;
            force[2] += p.turn * spin * spin * rz;
        }

        const u = this.up;
        const inA = this.inAxis;

        if (this.paired) for (let k = 0; k < 3; k++) inA[k] = this.inward[k];
        else for (let k = 0; k < 3; k++) inA[k] = this.tipDirection[k];

        const along = inA[0] * u[0] + inA[1] * u[1] + inA[2] * u[2];

        for (let k = 0; k < 3; k++) inA[k] -= along * u[k];

        if (!normalise(inA)) perpendicular(u, inA);

        const side = this.side;

        side[0] = u[1] * inA[2] - u[2] * inA[1];
        side[1] = u[2] * inA[0] - u[0] * inA[2];
        side[2] = u[0] * inA[1] - u[1] * inA[0];

        const state = [0, 0];
        const result = this.result;
        const velocity = this.velocity;

        result.fill(0);
        velocity.fill(0);

        for (let a = 0; a < 3; a++) {
            const axis = a === 0 ? u : a === 1 ? inA : side;

            state[0] = dot3(this.lump, axis);
            state[1] = dot3(this.lumpVelocity, axis);

            let w = omega;

            if (a === 1) w = this.paired ? omega * Math.sqrt(state[0] > 0 ? p.squeezeIn : p.squeezeOut) : omega * Math.sqrt(p.sideStiffness);
            else if (a === 2) w = omega * Math.sqrt(p.sideStiffness);

            const reach = Math.min(OMEGA_MAX, w);

            oscillate(state, dot3(force, axis), reach, zeta, h);

            for (let k = 0; k < 3; k++) {
                result[k] += state[0] * axis[k];
                velocity[k] += state[1] * axis[k];
            }
        }

        const length = Math.sqrt(dot3(result, result));

        if (length > 2 * limit) {
            const k = 2 * limit / length;

            for (let i = 0; i < 3; i++) { result[i] *= k; velocity[i] *= k; }
        }

        for (let i = 0; i < 3; i++) { this.lump[i] = result[i]; this.lumpVelocity[i] = velocity[i]; }

        this.lumpOmega = omega;
        softClamp(this.lump, 0.8 * limit, this.lumpShown);
    }

    /** Each node's own lag behind its target, riding on the lump: a spring along up and one across */
    nodesStep(p: FleshParams, h: number): void {
        const limit = this.limit(p);
        const tip = Math.min(1, 0.05 / Math.max(0.05, this.softness) * this.sizeScale);
        const firm = p.firmness * (this.dressed ? Math.sqrt(p.dressedStiffness) : 1);
        const zetaTip = this.dressed ? Math.max(p.nodeDamping, 0.45) : p.nodeDamping;
        const nodeShare = p.inertia * (1 - p.lumpShare);
        const sag = p.gravity / (STEP * STEP);
        const u = this.up;
        const before = this.lumpShownBefore;
        const now = this.lumpShown;
        const state = [0, 0];

        for (let i = 0; i < NODES; i++) {
            const w = this.cage.anchor[i];
            const soft = 1 - w;
            const at = i * 3;
            const ex = this.x[at] - (this.target[at] - this.shift[at]) - before[0] * soft;
            const ey = this.x[at + 1] - (this.target[at + 1] - this.shift[at + 1]) - before[1] * soft;
            const ez = this.x[at + 2] - (this.target[at + 2] - this.shift[at + 2]) - before[2] * soft;
            const k = Math.min(1, tip + (1 - tip) * w);
            const lag = Math.sqrt(ex * ex + ey * ey + ez * ez);
            const base = Math.sqrt(k) / STEP * (1 + 0.6 * soft) * firm;
            let stiffening = Math.sqrt(1 + square(lag / Math.max(1e-6, p.stiffen * limit)));
            const zeta = zetaTip + (1 - zetaTip) * w * w;

            // in steps of two percent, as the game does
            stiffening = 1 + rint((stiffening - 1) * 50) / 50;

            const omegaUp = Math.min(OMEGA_MAX, base * stiffening);
            const omegaSide = Math.min(OMEGA_MAX, base * stiffening * Math.sqrt(p.sideStiffness));
            const ax = -nodeShare * soft * this.acceleration[at];
            const ay = -nodeShare * soft * this.acceleration[at + 1] - sag * soft - this.riseAcceleration * soft;
            const az = -nodeShare * soft * this.acceleration[at + 2];
            const vx = this.lagVelocity[at];
            const vy = this.lagVelocity[at + 1];
            const vz = this.lagVelocity[at + 2];
            const eu = ex * u[0] + ey * u[1] + ez * u[2];
            const vu = vx * u[0] + vy * u[1] + vz * u[2];
            const au = ax * u[0] + ay * u[1] + az * u[2];

            state[0] = eu;
            state[1] = vu;
            oscillate(state, au, omegaUp, zeta, h);

            const eu2 = state[0];
            const vu2 = state[1];

            for (let c = 0; c < 3; c++) {
                const e = (c === 0 ? ex : c === 1 ? ey : ez) - eu * u[c];
                const v = (c === 0 ? vx : c === 1 ? vy : vz) - vu * u[c];
                const a = (c === 0 ? ax : c === 1 ? ay : az) - au * u[c];

                state[0] = e;
                state[1] = v;
                oscillate(state, a, omegaSide, zeta, h);
                this.x[at + c] = this.target[at + c] + now[c] * soft + state[0] + eu2 * u[c];
                this.lagVelocity[at + c] = state[1] + vu2 * u[c];
            }
        }
    }

    /** The cage pulled toward its own shape, turned and moved as the nodes are now: it may swing and shift as a whole but keeps its form */
    shapeStep(p: FleshParams): void {
        const pull = p.shape / Math.max(0.1, p.shapeSoftness * this.softness / Math.max(1e-6, p.softness));

        if (pull <= 0) return;

        let total = 0;
        const cx = [0, 0, 0];
        const ct = [0, 0, 0];

        for (let i = 0; i < NODES; i++) {
            const m = 1 - this.cage.anchor[i];

            if (m < 0.05) continue;

            total += m;

            for (let k = 0; k < 3; k++) {
                cx[k] += m * this.x[i * 3 + k];
                ct[k] += m * this.target[i * 3 + k];
            }
        }

        if (total < 1e-9) return;

        for (let k = 0; k < 3; k++) { cx[k] /= total; ct[k] /= total; }

        const spread = new Array<number>(9).fill(0);

        for (let i = 0; i < NODES; i++) {
            const m = 1 - this.cage.anchor[i];

            if (m < 0.05) continue;

            for (let a = 0; a < 3; a++) {
                const q = this.x[i * 3 + a] - cx[a];

                for (let b = 0; b < 3; b++) spread[a * 3 + b] += m * q * (this.target[i * 3 + b] - ct[b]);
            }
        }

        const rotation = new Array<number>(9).fill(0);

        if (!polar(spread, rotation)) return;

        for (let i = 0; i < NODES; i++) {
            const m = 1 - this.cage.anchor[i];

            if (m < 0.05) continue;

            const qx = this.target[i * 3] - ct[0];
            const qy = this.target[i * 3 + 1] - ct[1];
            const qz = this.target[i * 3 + 2] - ct[2];
            const amount = Math.min(1, pull * m);

            for (let a = 0; a < 3; a++) {
                const goal = cx[a] + rotation[a * 3] * qx + rotation[a * 3 + 1] * qy + rotation[a * 3 + 2] * qz;

                this.x[i * 3 + a] += (goal - this.x[i * 3 + a]) * amount;
            }
        }
    }

    /** One pass over the cage's links: each kept toward the length its two targets are apart, the freer end moving more */
    linksStep(p: FleshParams): void {
        const geometry = FleshGeometry.get();
        const stiffness = p.link;

        if (stiffness <= 0) return;

        if (this.linksStale) {
            for (let l = 0; l < geometry.linkA.length; l++) {
                const a = geometry.linkA[l] * 3;
                const b = geometry.linkB[l] * 3;
                const rx = this.target[b] - this.target[a];
                const ry = this.target[b + 1] - this.target[a + 1];
                const rz = this.target[b + 2] - this.target[a + 2];

                this.linkLength[l] = Math.sqrt(rx * rx + ry * ry + rz * rz);
            }

            this.linksStale = false;
        }

        for (let l = 0; l < geometry.linkA.length; l++) {
            const a = geometry.linkA[l];
            const b = geometry.linkB[l];
            const wa = 1 - this.cage.anchor[a];
            const wb = 1 - this.cage.anchor[b];

            if (wa + wb < 1e-6) continue;

            const dx = this.x[b * 3] - this.x[a * 3];
            const dy = this.x[b * 3 + 1] - this.x[a * 3 + 1];
            const dz = this.x[b * 3 + 2] - this.x[a * 3 + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (length < 1e-9) continue;

            const error = (length - this.linkLength[l]) * stiffness / length;
            const sa = wa / (wa + wb);
            const sb = wb / (wa + wb);

            this.x[a * 3] += dx * error * sa;
            this.x[a * 3 + 1] += dy * error * sa;
            this.x[a * 3 + 2] += dz * error * sa;
            this.x[b * 3] -= dx * error * sb;
            this.x[b * 3 + 1] -= dy * error * sb;
            this.x[b * 3 + 2] -= dz * error * sb;
        }
    }

    /** Each node softly held within the limit (free to half of it, then ever stiffer, never past it), anything not a number put back, and the displacement kept */
    settle(p: FleshParams): void {
        const limit = this.limit(p);
        const free = 0.5 * limit;

        for (let i = 0; i < NODES; i++) {
            const at = i * 3;
            let dx = this.x[at] - this.target[at];
            let dy = this.x[at + 1] - this.target[at + 1];
            let dz = this.x[at + 2] - this.target[at + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (!Number.isFinite(length)) {
                for (let c = 0; c < 3; c++) { this.x[at + c] = this.target[at + c]; this.lagVelocity[at + c] = 0; }

                dx = 0; dy = 0; dz = 0;
            }
            else if (length > free) {
                const k = (free + (limit - free) * Math.tanh((length - free) / (limit - free))) / length;

                dx *= k; dy *= k; dz *= k;
                this.x[at] = this.target[at] + dx;
                this.x[at + 1] = this.target[at + 1] + dy;
                this.x[at + 2] = this.target[at + 2] + dz;
            }

            this.displacement[at] = dx;
            this.displacement[at + 1] = dy;
            this.displacement[at + 2] = dz;
        }

        for (let k = 0; k < 3; k++) {
            if (!Number.isFinite(this.lump[k]) || !Number.isFinite(this.lumpVelocity[k])) {
                this.lump.fill(0);
                this.lumpVelocity.fill(0);
                this.lumpShown.fill(0);

                break;
            }
        }
    }

    /** Moves the free nodes that have crossed the plane halfway back toward it each step */
    keepBehind(): void {
        for (let i = 0; i < NODES; i++) {
            if (this.cage.anchor[i] > HELD) continue;

            const at = i * 3;
            const past = (this.x[at] - this.planePoint[0]) * this.planeNormal[0] + (this.x[at + 1] - this.planePoint[1]) * this.planeNormal[1]
                + (this.x[at + 2] - this.planePoint[2]) * this.planeNormal[2] - this.planeAllow;

            if (past > 0) {
                const back = past * 0.5;

                this.x[at] -= this.planeNormal[0] * back;
                this.x[at + 1] -= this.planeNormal[1] * back;
                this.x[at + 2] -= this.planeNormal[2] * back;
                this.contact[i] += back;
            }
        }
    }

    /**
     * What presses into the flesh: a free node inside a shape goes straight toward the middle of the flesh until it is clear (never past most of the way there),
     * and the volume pressed in swells out along the free nodes that are clear, as much as {@code bulge} says. The shapes are in the world, as the nodes are
     */
    press(shapes: readonly Placed[], bulge: number): void {
        if (shapes.length === 0) return;

        const probe: V3 = [0, 0, 0];
        const inside = (x: number, y: number, z: number): boolean => {
            for (const s of shapes) {
                probe[0] = x; probe[1] = y; probe[2] = z;

                if (pushOut(s, probe, PRESS_SKIN)) return true;
            }

            return false;
        };
        const c = CENTRE * 3;
        const pressed = new Uint8Array(SURFACE);
        let depth = 0;

        for (let i = 0; i < SURFACE; i++) {
            if (this.cage.anchor[i] > HELD) continue;

            const at = i * 3;
            const x = this.x[at]; const y = this.x[at + 1]; const z = this.x[at + 2];

            if (!inside(x, y, z)) continue;

            const dx = this.x[c] - x; const dy = this.x[c + 1] - y; const dz = this.x[c + 2] - z;
            let t = 0.9;

            if (!inside(x + dx * t, y + dy * t, z + dz * t)) {
                let lo = 0;
                let hi = t;

                for (let k = 0; k < 8; k++) {
                    const mid = (lo + hi) / 2;

                    if (inside(x + dx * mid, y + dy * mid, z + dz * mid)) lo = mid;
                    else hi = mid;
                }

                t = hi;
            }

            this.x[at] += dx * t; this.x[at + 1] += dy * t; this.x[at + 2] += dz * t;

            const moved = t * Math.sqrt(dx * dx + dy * dy + dz * dz);

            this.contact[i] += moved;
            depth += moved;
            pressed[i] = 1;
        }

        if (depth <= 0 || bulge <= 0) return;

        let free = 0;

        for (let i = 0; i < SURFACE; i++) if (!pressed[i] && this.cage.anchor[i] <= HELD) free++;

        if (free === 0) return;

        const out = Math.min(0.03, bulge * depth * 0.3 / free);

        for (let i = 0; i < SURFACE; i++) {
            if (pressed[i] || this.cage.anchor[i] > HELD) continue;

            const at = i * 3;
            const dx = this.x[at] - this.x[c]; const dy = this.x[at + 1] - this.x[c + 1]; const dz = this.x[at + 2] - this.x[c + 2];
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

            this.x[at] += dx / length * out; this.x[at + 1] += dy / length * out; this.x[at + 2] += dz / length * out;
        }
    }

    /** A kick: a world velocity in blocks per second, taken by the swing and by every node */
    kick(v: V3): void {
        for (let a = 0; a < 3; a++) this.lumpVelocity[a] += v[a];

        for (let i = 0; i < NODES; i++) for (let a = 0; a < 3; a++) this.lagVelocity[i * 3 + a] += v[a] * (1 - this.cage.anchor[i]);
    }

    get lumpVelocityOf(): readonly number[] { return this.lumpVelocity; }
    get omega(): number { return this.lumpOmega; }

    // the pair reads and writes these
    pairLump(): { lump: number[]; velocity: number[] } { return { lump: this.lump, velocity: this.lumpVelocity }; }
    setInward(n: V3): void { this.inward[0] = n[0]; this.inward[1] = n[1]; this.inward[2] = n[2]; }
}

/** Where the two of a pair meet: the plane halfway between their middles, and which way is in for each */
export function pairPlane(a: FleshRegion, b: FleshRegion): void {
    const c = CENTRE * 3;
    let nx = b.target[c] + b.lumpShown[0] - a.target[c] - a.lumpShown[0];
    let ny = b.target[c + 1] + b.lumpShown[1] - a.target[c + 1] - a.lumpShown[1];
    let nz = b.target[c + 2] + b.lumpShown[2] - a.target[c + 2] - a.lumpShown[2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (length < 1e-6) {
        a.paired = false;
        b.paired = false;

        return;
    }

    nx /= length; ny /= length; nz /= length;

    for (let k = 0; k < 3; k++) {
        const middle = (a.target[c + k] + a.lumpShown[k] + b.target[c + k] + b.lumpShown[k]) * 0.5;

        a.planePoint[k] = middle;
        b.planePoint[k] = middle;
    }

    a.planeNormal[0] = nx; a.planeNormal[1] = ny; a.planeNormal[2] = nz;
    b.planeNormal[0] = -nx; b.planeNormal[1] = -ny; b.planeNormal[2] = -nz;
    a.setInward([nx, ny, nz]);
    b.setInward([-nx, -ny, -nz]);
    a.planeAllow = Math.max(0, a.reachPast(a.target));
    b.planeAllow = Math.max(0, b.reachPast(b.target));
    a.paired = true;
    b.paired = true;
}

/** The two of a pair: kept on their own sides, squeezed apart when pressed together, and moved together when dressed */
export function pairStep(a: FleshRegion, b: FleshRegion, p: FleshParams, h: number): void {
    if (!a.paired || !b.paired) return;

    const A = a.pairLump();
    const B = b.pairLump();

    if (a.dressed && b.dressed && p.dressedCouple > 0) {
        for (let k = 0; k < 3; k++) {
            const mean = (A.lump[k] + B.lump[k]) * 0.5;
            const meanVelocity = (A.velocity[k] + B.velocity[k]) * 0.5;

            A.lump[k] += (mean - A.lump[k]) * p.dressedCouple;
            B.lump[k] += (mean - B.lump[k]) * p.dressedCouple;
            A.velocity[k] += (meanVelocity - A.velocity[k]) * p.dressedCouple;
            B.velocity[k] += (meanVelocity - B.velocity[k]) * p.dressedCouple;
        }
    }

    const n = a.planeNormal;
    const front = a.reachPast(a.target);
    const back = b.reachPast(b.target);
    const gap = Math.max(0, -front - back);
    const closing = dot3(A.lump, n) - dot3(B.lump, n);
    const into = closing - gap;

    a.squeeze = 0;
    b.squeeze = 0;

    if (into > 0) {
        const omega = 0.5 * (a.omega + b.omega) * Math.sqrt(p.squeezeStiffness);
        const approach = dot3(A.velocity, n) - dot3(B.velocity, n);
        const push = (omega * omega * into + 2 * 0.6 * omega * approach) * h * 0.5;

        for (let k = 0; k < 3; k++) {
            A.velocity[k] -= n[k] * push;
            B.velocity[k] += n[k] * push;
        }

        if (into > SQUEEZE_MAX) {
            const back2 = (into - SQUEEZE_MAX) * 0.5;

            for (let k = 0; k < 3; k++) {
                A.lump[k] -= n[k] * back2;
                B.lump[k] += n[k] * back2;
            }
        }

        const squeeze = Math.min(1, into / SQUEEZE_MAX);

        a.squeeze = squeeze;
        b.squeeze = squeeze;
    }

    a.keepBehind();
    b.keepBehind();
}

/**
 * One step of every region of one flesh, {@link STEP} long (or {@code h}): each region's {@link FleshRegion.target}, up and tip direction must be set. What presses
 * on it is the caller's: {@code press} is called for each region before it settles, to push the shapes that press it into the cage
 */
export function fleshStep(regions: readonly FleshRegion[], p: FleshParams, h: number = STEP, press?: (region: FleshRegion) => void): void {
    for (const r of regions) {
        r.begin(h);
        r.gait(p, h);
    }

    if (regions.length === 2) pairPlane(regions[0], regions[1]);

    for (const r of regions) {
        r.lumpStep(p, h);
        r.nodesStep(p, h);
        r.shapeStep(p);
        r.linksStep(p);
    }

    if (regions.length === 2) pairStep(regions[0], regions[1], p, h);

    for (const r of regions) {
        press?.(r);
        r.settle(p);
    }
}

// ---------------- the vertices following the cage ----------------

/** {@code exp(L tanh(ln(1 + volume x) / L))} with {@code L = -ln 0.75}: the same as {@code 1 + volume x} near 1, and never below 0.75 or above 4/3 */
function stretchOf(x: number, volume: number): number {
    const l = -Math.log(0.75);
    const inner = Math.max(0.05, 1 + volume * x);

    return Math.exp(l * Math.tanh(Math.log(inner) / l));
}

/** The rotation about the unit axis by {@code angle}, row major */
function rotationAbout(x: number, y: number, z: number, angle: number): number[] {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const k = 1 - c;

    return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}

/** How the region's frame (where the cage and the vertices are fitted) sits in the world now: a rigid motion */
export interface RegionFrame {
    /** A direction of the world into the region's frame, and back */
    toRest(v: V3): V3;
    toWorld(v: V3): V3;
    /** A point of the world into the region's frame */
    pointToRest(p: V3): V3;
}

/** Every vertex of a region's meshes, following its cage: the cage's blend, the swing turned about the pivot, the stretch that keeps the volume, and the pair's plane */
export class FleshSkin {
    private readonly smoothed = new Float64Array(NODES * 3);

    constructor(readonly cage: FleshCage, readonly binding: Binding, readonly rest: readonly V3[]) {}

    /** Each vertex's displacement, world, from where the animation puts it */
    displacements(region: FleshRegion, p: FleshParams, frame: RegionFrame): V3[] {
        const geometry = FleshGeometry.get();
        const cage = this.cage;
        const local = new Float64Array(NODES * 3);

        for (let i = 0; i < NODES; i++) {
            const d = frame.toRest([region.displacement[i * 3], region.displacement[i * 3 + 1], region.displacement[i * 3 + 2]]);

            local[i * 3] = d[0]; local[i * 3 + 1] = d[1]; local[i * 3 + 2] = d[2];
        }

        // each node evened out with its neighbours, so the surface is smooth between them
        const surface = [0, 0, 0];

        for (let i = 0; i < SURFACE; i++) {
            const around = geometry.neighbours[i];
            let sx = 0; let sy = 0; let sz = 0;

            for (const j of around) { sx += local[j * 3]; sy += local[j * 3 + 1]; sz += local[j * 3 + 2]; }

            this.smoothed[i * 3] = local[i * 3] * 0.5 + sx / around.length * 0.5;
            this.smoothed[i * 3 + 1] = local[i * 3 + 1] * 0.5 + sy / around.length * 0.5;
            this.smoothed[i * 3 + 2] = local[i * 3 + 2] * 0.5 + sz / around.length * 0.5;
            surface[0] += local[i * 3]; surface[1] += local[i * 3 + 1]; surface[2] += local[i * 3 + 2];
        }

        const c = CENTRE * 3;

        for (let k = 0; k < 3; k++) this.smoothed[c + k] = local[c + k] * 0.5 + surface[k] / SURFACE * 0.5;

        // the lump's swing in the region's frame, and the turn and stretch it makes
        const m = frame.toRest([region.lumpShown[0], region.lumpShown[1], region.lumpShown[2]]);
        const t = cage.tip;
        const ax = t[1] * m[2] - t[2] * m[1];
        const ay = t[2] * m[0] - t[0] * m[2];
        const az = t[0] * m[1] - t[1] * m[0];
        const across = Math.sqrt(ax * ax + ay * ay + az * az);
        let turn: number[] | null = null;

        if (p.rigid > 0 && across > 1e-9) turn = rotationAbout(ax / across, ay / across, az / across, p.rigid * across / cage.length);

        let stretch: number[] | null = null;

        if (p.volume > 0 && !region.dressed) {
            const up = cage.up;
            const out: number[] = [t[0], t[1], t[2]];
            const along = dot3(out, up);

            for (let k = 0; k < 3; k++) out[k] -= along * up[k];

            const outLength = Math.sqrt(dot3(out, out));

            if (outLength > 1e-6) {
                for (let k = 0; k < 3; k++) out[k] /= outLength;

                const down = [-up[0], -up[1], -up[2]];
                const side = [down[1] * out[2] - down[2] * out[1], down[2] * out[0] - down[0] * out[2], down[0] * out[1] - down[1] * out[0]];
                const scale = Math.max(1e-6, cage.length);
                const ld = stretchOf((m[0] * down[0] + m[1] * down[1] + m[2] * down[2]) / scale, p.volume);
                const lo = stretchOf((m[0] * out[0] + m[1] * out[1] + m[2] * out[2]) / scale, p.volume);
                const ls = 1 / (ld * lo);

                stretch = new Array<number>(9).fill(0);

                for (let a = 0; a < 3; a++) {
                    for (let b = 0; b < 3; b++) stretch[a * 3 + b] = (ld - 1) * down[a] * down[b] + (lo - 1) * out[a] * out[b] + (ls - 1) * side[a] * side[b];
                }
            }
        }

        // the pair's plane in the region's frame
        let plane = region.paired;
        let px = 0; let py = 0; let pz = 0; let nx = 0; let ny = 0; let nz = 0; let allow = 0;
        let edge = 0.025;

        if (plane) {
            const point = frame.pointToRest([region.planePoint[0], region.planePoint[1], region.planePoint[2]]);
            const normal = frame.toRest([region.planeNormal[0], region.planeNormal[1], region.planeNormal[2]]);
            const scale = Math.sqrt(dot3(normal, normal));

            if (scale < 1e-9) {
                plane = false;
            }
            else {
                px = point[0]; py = point[1]; pz = point[2];
                nx = normal[0] / scale; ny = normal[1] / scale; nz = normal[2] / scale;
                allow = region.planeAllow * scale;
                edge *= scale;
            }
        }

        const out: V3[] = [];
        const centre = cage.centre;
        const pivot = cage.pivot;

        for (let k = 0; k < this.rest.length; k++) {
            const [qx, qy, qz] = this.rest[k];
            let sx = 0; let sy = 0; let sz = 0;

            for (let j = this.binding.start[k]; j < this.binding.start[k + 1]; j++) {
                const node = this.binding.node[j] * 3;
                const w = this.binding.weight[j];

                sx += this.smoothed[node] * w; sy += this.smoothed[node + 1] * w; sz += this.smoothed[node + 2] * w;
            }

            const s = this.binding.surface[k];
            const soft = this.binding.softness[k];
            let dx = sx * s + this.smoothed[c] * (1 - s);
            let dy = sy * s + this.smoothed[c + 1] * (1 - s);
            let dz = sz * s + this.smoothed[c + 2] * (1 - s);

            if (turn) {
                const rx = qx - pivot[0]; const ry = qy - pivot[1]; const rz = qz - pivot[2];
                const held = Math.min(1, 2 * soft);

                dx += (turn[0] * rx + turn[1] * ry + turn[2] * rz - rx) * held - m[0] * soft;
                dy += (turn[3] * rx + turn[4] * ry + turn[5] * rz - ry) * held - m[1] * soft;
                dz += (turn[6] * rx + turn[7] * ry + turn[8] * rz - rz) * held - m[2] * soft;
            }

            if (stretch) {
                const rx = qx - centre[0]; const ry = qy - centre[1]; const rz = qz - centre[2];

                dx += (stretch[0] * rx + stretch[1] * ry + stretch[2] * rz) * soft;
                dy += (stretch[3] * rx + stretch[4] * ry + stretch[5] * rz) * soft;
                dz += (stretch[6] * rx + stretch[7] * ry + stretch[8] * rz) * soft;
            }

            if (region.dressed) {
                const rx = qx - centre[0]; const ry = qy - centre[1]; const rz = qz - centre[2];
                const length = Math.sqrt(rx * rx + ry * ry + rz * rz);

                if (length > 1e-9) {
                    const outward = (dx * rx + dy * ry + dz * rz) / length;
                    const room = 0.15 * cage.limit;

                    if (outward > room) {
                        const back = (outward - room) / length;

                        dx -= rx * back; dy -= ry * back; dz -= rz * back;
                    }
                }
            }

            if (plane) {
                const past = (qx + dx - px) * nx + (qy + dy - py) * ny + (qz + dz - pz) * nz - allow;

                if (past > 0) {
                    const kept = past < 2 * edge ? past - past * past / (4 * edge) : edge;
                    const flattened = past - kept;

                    dx -= nx * flattened; dy -= ny * flattened; dz -= nz * flattened;

                    let ox = qx + dx - px; let oy = qy + dy - py; let oz = qz + dz - pz;
                    const normal = ox * nx + oy * ny + oz * nz;

                    ox -= normal * nx; oy -= normal * ny; oz -= normal * nz;

                    const radial = Math.sqrt(ox * ox + oy * oy + oz * oz);

                    if (radial > 1e-9) {
                        const rim = p.rim * flattened / radial;

                        dx += ox * rim; dy += oy * rim; dz += oz * rim;
                    }
                }
            }

            out.push(frame.toWorld([dx * p.weight, dy * p.weight, dz * p.weight]));
        }

        return out;
    }
}
