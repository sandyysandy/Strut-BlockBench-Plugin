/**
 * The flesh of one model in the plugin: for each flesh entry, a cage fitted to the mesh on its bone (a pair of bones, or a mesh that holds two parts, make a pair
 * that press on each other), stepped on the rig's clock, and every vertex of the mesh following it. The twin of the game's {@code FleshInstance}, without what
 * presses on it and the body (see {@link ./flesh}). No Blockbench globals
 */
import { applyRotation, ClothMesh, fitParticles, rigidFit, weld } from './cloth';
import { CENTRE, FleshCage, FleshParams, FleshRegion, FleshSkin, fleshStep, NODES, RegionFrame, resolveFlesh } from './flesh';
import { qaxisY, qrotate, sub, add, V3 } from './math';
import type { ClothMeshInput } from './rig';
import type { Placed } from './solvers';

/** A mesh (or the part of it a region owns) that is flesh: its welded particles, and which of them the region moves */
interface Member {
    readonly input: ClothMeshInput;
    readonly welded: ClothMesh;
    /** The first input vertex of each particle, to read where the animation puts it */
    readonly vertexOfParticle: number[];
    /** The particles of the welded mesh this region owns, and the region's number for each of them (-1 for another region's) */
    readonly ids: number[];
    readonly indexOf: number[];
}

interface Carried {
    readonly input: ClothMeshInput;
    /** The region's particles whose movement it follows */
    readonly fit: number[];
}

interface Frame {
    centreFrom: V3;
    centreTo: V3;
    rotation: ReturnType<typeof rigidFit>['rotation'];
}

interface Region {
    readonly region: FleshRegion;
    readonly cage: FleshCage;
    readonly skin: FleshSkin;
    readonly rest: V3[];
    readonly members: Member[];
    carried: Carried[];
    /** Where the animation puts each particle now (world), set before each step */
    anim: V3[];
    /** The fit of the region's rest to the animation at the last step, and the displacement of every particle it made then (world, at that step) */
    fit: Frame | null;
    disp: V3[] | null;
    pivotSet: boolean;
}

interface Part {
    readonly name: string;
    readonly bone: string;
    readonly params: FleshParams;
    readonly regions: Region[];
}

const transposeApply = (r: Frame['rotation'], v: V3): V3 => [r[0] * v[0] + r[3] * v[1] + r[6] * v[2], r[1] * v[0] + r[4] * v[1] + r[7] * v[2], r[2] * v[0] + r[5] * v[1] + r[8] * v[2]];

/**
 * The connected pieces of a mesh (particles that share a triangle are one piece) that are each a good share of it, as the particles of each; null when it has fewer
 * than two. A piece inside another's bounds (a tip merged into the mesh of the pouch it sits on) is part of it, and a small piece goes with the big one nearest it
 */
export function pieces(welded: ClothMesh): number[][] | null {
    const n = welded.rest.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }

        return i;
    };

    for (let t = 0; t + 2 < welded.triangles.length; t += 3) {
        parent[find(welded.triangles[t + 1])] = find(welded.triangles[t]);
        parent[find(welded.triangles[t + 2])] = find(welded.triangles[t]);
    }

    const size = new Array<number>(n).fill(0);

    for (let i = 0; i < n; i++) size[find(i)]++;

    const threshold = Math.max(6, Math.floor(n / 4));
    const low = new Map<number, V3>();
    const high = new Map<number, V3>();

    for (let i = 0; i < n; i++) {
        const root = find(i);

        if (size[root] < threshold) continue;

        const lo = low.get(root) ?? [Infinity, Infinity, Infinity];
        const hi = high.get(root) ?? [-Infinity, -Infinity, -Infinity];

        for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a], welded.rest[i][a]);
            hi[a] = Math.max(hi[a], welded.rest[i][a]);
        }

        low.set(root, lo);
        high.set(root, hi);
    }

    const volume = (r: number): number => {
        let v = 1;

        for (let a = 0; a < 3; a++) v *= Math.max(high.get(r)![a] - low.get(r)![a], 0.01);

        return v;
    };
    const roots = [...low.keys()];

    for (const a of roots) {
        for (const b of roots) {
            if (a === b || find(a) !== a || find(b) !== b) continue;

            const va = volume(a);
            const vb = volume(b);

            if (va > vb || (va === vb && a > b)) continue;

            let share = 1;

            for (let k = 0; k < 3; k++) {
                const extent = Math.max(high.get(a)![k] - low.get(a)![k], 0.01);
                const overlap = Math.min(high.get(a)![k], high.get(b)![k]) - Math.max(low.get(a)![k], low.get(b)![k]);

                share *= Math.max(0, Math.min(1, overlap / extent));
            }

            if (share >= 0.25) {
                parent[a] = b;
                size[b] += size[a];

                for (let k = 0; k < 3; k++) {
                    high.get(b)![k] = Math.max(high.get(b)![k], high.get(a)![k]);
                    low.get(b)![k] = Math.min(low.get(b)![k], low.get(a)![k]);
                }
            }
        }
    }

    const big = roots.filter(r => find(r) === r);

    if (big.length < 2) return null;

    const middle = big.map(() => [0, 0, 0] as V3);
    const count = big.map(() => 0);

    for (let i = 0; i < n; i++) {
        const at = big.indexOf(find(i));

        if (at < 0) continue;

        for (let a = 0; a < 3; a++) middle[at][a] += welded.rest[i][a];

        count[at]++;
    }

    middle.forEach((m, b) => { for (let a = 0; a < 3; a++) m[a] /= count[b]; });

    const out: number[][] = big.map(() => []);
    const chosen = new Map<number, number>();

    for (let i = 0; i < n; i++) {
        const root = find(i);
        let at = big.indexOf(root);

        if (at < 0) {
            const known = chosen.get(root);

            if (known === undefined) {
                let nearest = Infinity;

                at = 0;

                big.forEach((_, b) => {
                    const d = (middle[b][0] - welded.rest[i][0]) ** 2 + (middle[b][1] - welded.rest[i][1]) ** 2 + (middle[b][2] - welded.rest[i][2]) ** 2;

                    if (d < nearest) { nearest = d; at = b; }
                });
                chosen.set(root, at);
            }
            else {
                at = known;
            }
        }

        out[at].push(i);
    }

    return out;
}

/** Leaves each rigid piece on the one region whose middle is nearest it */
function keepCarriedOnNearest(regions: Region[]): void {
    const best = new Map<string, { region: Region; distance: number }>();

    for (const r of regions) {
        for (const c of r.carried) {
            const middle: V3 = [0, 0, 0];

            for (const v of c.input.rest) for (let a = 0; a < 3; a++) middle[a] += v[a] / c.input.rest.length;

            const distance = (middle[0] - r.cage.centre[0]) ** 2 + (middle[1] - r.cage.centre[1]) ** 2 + (middle[2] - r.cage.centre[2]) ** 2;
            const old = best.get(c.input.key);

            if (!old || distance < old.distance) best.set(c.input.key, { region: r, distance });
        }
    }

    for (const r of regions) r.carried = r.carried.filter(c => best.get(c.input.key)?.region === r);
}

export class FleshRig {
    private readonly parts: Part[] = [];
    /** What the checker says about the entries, for the panel */
    readonly problems: string[] = [];

    constructor(boneNames: ReadonlySet<string>, parents: ReadonlyMap<string, string | null>, doc: Record<string, any>, meshes: readonly ClothMeshInput[]) {
        const entries = { ...(typeof doc.soft === 'object' && doc.soft !== null ? doc.soft : {}), ...(typeof doc.flesh === 'object' && doc.flesh !== null ? doc.flesh : {}) };
        const under = (bone: string, root: string): boolean => {
            for (let at: string | null | undefined = bone; at; at = parents.get(at)) if (at === root) return true;

            return false;
        };

        for (const [name, raw] of Object.entries(entries)) {
            const entry = (raw ?? {}) as Record<string, any>;
            const params = resolveFlesh({ bone: name, ...entry }, [], `flesh "${name}"`);
            const where = `flesh "${name}"`;
            const regions: Region[] = [];

            for (const bone of params.bones.slice(0, 2)) {
                if (!boneNames.has(bone)) {
                    this.problems.push(`${where}: bone "${bone}" is not in the model`);

                    continue;
                }

                const below = meshes.filter(m => under(m.bone, bone));
                const own = below.filter(m => m.bone === bone);
                // when the root has meshes of its own, the meshes on the bones under it ride on it; when it has none, every mesh under it is flesh
                const soft = own.length > 0 && !params.nestedSoft ? own : below;
                const ride = own.length > 0 && !params.nestedSoft ? below.filter(m => m.bone !== bone) : [];

                for (const boneName of params.carry) {
                    if (!boneNames.has(boneName)) this.problems.push(`${where}: carries bone "${boneName}", which is not in the model`);
                    else ride.push(...meshes.filter(m => m.bone === boneName && !under(m.bone, bone)));
                }

                if (soft.length === 0) {
                    this.problems.push(`${where}: bone "${bone}" has no mesh or cube`);

                    continue;
                }

                const welds = soft.map(input => weld(input.rest, input.faces));
                // a mesh that holds two parts is a region for each, when it is the only soft mesh
                const split = soft.length === 1 ? pieces(welds[0]) : null;
                const owned: number[][][] = split ? split.map(ids => [ids]) : [soft.map((_, i) => welds[i].rest.map((__, k) => k))];

                owned.forEach(idsPerMember => {
                    const members: Member[] = [];
                    const rest: V3[] = [];

                    idsPerMember.forEach((ids, i) => {
                        const welded = welds[i];
                        const vertexOfParticle = new Array<number>(welded.rest.length).fill(-1);
                        const indexOf = new Array<number>(welded.rest.length).fill(-1);

                        welded.particleOfVertex.forEach((k, v) => { if (vertexOfParticle[k] < 0) vertexOfParticle[k] = v; });
                        ids.forEach(id => { indexOf[id] = rest.length; rest.push(welded.rest[id]); });
                        members.push({ input: soft[i], welded, vertexOfParticle, ids, indexOf });
                    });

                    if (rest.length < 6) return;

                    const cage = new FleshCage(rest, params);
                    const skin = new FleshSkin(cage, cage.bind(rest), rest);

                    regions.push({
                        region: new FleshRegion(cage), cage, skin, rest, members, carried: ride.map(input => ({ input, fit: fitParticles(rest, input.rest) })),
                        anim: [], fit: null, disp: null, pivotSet: false,
                    });
                });
            }

            // a mesh that rides on the flesh (a top over a pair) is named by each of the pair's bones, so each of them made a region with it: it rides on the one whose
            // middle is nearest it, and only that one moves it
            keepCarriedOnNearest(regions);

            if (regions.length > 0) this.parts.push({ name, bone: params.bones[0], params, regions });
        }
    }

    /** The flesh that has {@code bone} among its bones: its name, bones, the layers it is pressed by and the model's bones that press it */
    partOf(bone: string): { name: string; bones: readonly string[]; layers: readonly string[]; presses: readonly string[] } | null {
        const part = this.parts.find(p => p.params.bones.includes(bone));

        return part ? { name: part.name, bones: part.params.bones, layers: part.params.collidesWith, presses: part.params.presses } : null;
    }

    get count(): number { return this.parts.reduce((s, p) => s + p.regions.length, 0); }

    reset(): void {
        for (const p of this.parts) {
            for (const r of p.regions) {
                r.region.reset();
                r.fit = null;
                r.disp = null;
            }
        }
    }

    /** Where the animation puts each region's particles now: read from the meshes' animated vertices */
    prepare(animated: ReadonlyMap<string, readonly V3[]>): void {
        for (const p of this.parts) {
            for (const r of p.regions) {
                const anim: V3[] = [];
                let ok = true;

                for (const m of r.members) {
                    const now = animated.get(m.input.key);

                    if (!now) { ok = false; break; }

                    for (const id of m.ids) anim.push(now[m.vertexOfParticle[id]]);
                }

                r.anim = ok ? anim : [];
            }
        }
    }

    /**
     * One step with the entity at {@code stepPos}: each region's cage carried by where the animation puts its mesh (a rigid fit of the rest to it), and every
     * region of a flesh stepped together
     *
     * @param place A point of the animation as it is placed on the entity at this step
     * @param origin Where the animation leaves a bone, as placed at this step, for the swing's pivot
     */
    step(stepPos: V3, place: (p: V3) => V3, origin: (bone: string) => V3 | null, controlsSoftness = 1, pressers?: (name: string, params: FleshParams) => Placed[]): void {
        for (const p of this.parts) {
            const live = p.regions.filter(r => r.anim.length > 0);

            if (live.length === 0) continue;

            for (const r of live) {
                const anim = r.anim.map(place);
                const fit = rigidFit(r.rest, anim);
                const R = fit.rotation;
                const t = r.region.target;

                for (let i = 0; i < NODES; i++) {
                    const q = applyRotation(R, sub([r.cage.rest[i * 3], r.cage.rest[i * 3 + 1], r.cage.rest[i * 3 + 2]], fit.centreFrom));

                    t[i * 3] = q[0] + fit.centreTo[0];
                    t[i * 3 + 1] = q[1] + fit.centreTo[1];
                    t[i * 3 + 2] = q[2] + fit.centreTo[2];
                }

                const up = applyRotation(R, r.cage.up);
                const tip = applyRotation(R, r.cage.tip);
                const ul = Math.hypot(...up) || 1;
                const tl = Math.hypot(...tip) || 1;

                for (let a = 0; a < 3; a++) {
                    r.region.up[a] = up[a] / ul;
                    r.region.tipDirection[a] = tip[a] / tl;
                }

                r.region.entityX = stepPos[0];
                r.region.entityY = stepPos[1];
                r.region.entityZ = stepPos[2];
                r.region.animatedHeight = t[CENTRE * 3 + 1] - stepPos[1];
                r.region.softness = p.params.softness * controlsSoftness;
                r.region.linksStale = true;

                // the swing turns about the bone's own pivot, found once from where the animation leaves the bone, unless it is far from the flesh
                if (!r.pivotSet) {
                    r.pivotSet = true;

                    const where = p.params.pivot ?? (p.params.bonePivot ? origin(p.bone) : null);

                    if (where && !p.params.pivot) {
                        const rest = transposeApply(R, sub(where, fit.centreTo));
                        const pivot: V3 = [rest[0] + fit.centreFrom[0], rest[1] + fit.centreFrom[1], rest[2] + fit.centreFrom[2]];
                        const away = Math.hypot(pivot[0] - r.cage.centre[0], pivot[1] - r.cage.centre[1], pivot[2] - r.cage.centre[2]);

                        if (away <= r.cage.length * 4) { r.cage.pivot[0] = pivot[0]; r.cage.pivot[1] = pivot[1]; r.cage.pivot[2] = pivot[2]; }
                    }
                }

                r.fit = { centreFrom: fit.centreFrom, centreTo: fit.centreTo, rotation: R };
                r.disp = null;
            }

            const shapes = pressers ? pressers(p.name, p.params) : [];

            fleshStep(live.map(r => r.region), p.params, undefined, shapes.length > 0 ? r => r.press(shapes, p.params.bulge) : undefined);
        }
    }

    /** A kick to the flesh of a bone, a world velocity in blocks per second */
    impulse(bone: string, v: V3): void {
        for (const p of this.parts) {
            if (p.bone !== bone && !p.params.bones.includes(bone)) continue;

            for (const r of p.regions) r.region.kick(v);
        }
    }

    private frameOf(r: Region): RegionFrame | null {
        const f = r.fit;

        if (!f) return null;

        return {
            toRest: v => transposeApply(f.rotation, v),
            toWorld: v => applyRotation(f.rotation, v),
            pointToRest: v => add(transposeApply(f.rotation, sub(v, f.centreTo)), f.centreFrom),
        };
    }

    private displacements(p: Part, r: Region): V3[] | null {
        if (r.disp) return r.disp;

        const frame = this.frameOf(r);

        if (!frame || !r.region.initialised) return null;

        r.disp = r.skin.displacements(r.region, p.params, frame);

        return r.disp;
    }

    /** The keys of the input meshes that are flesh, or ride on it, for hiding the originals while the preview runs */
    keys(): string[] {
        return this.parts.flatMap(p => p.regions.flatMap(r => [...r.members.map(m => m.input.key), ...r.carried.map(c => c.input.key)]));
    }

    /**
     * Where each vertex of the mesh with this key is now (blocks): the animated vertex moved by what the cage does there, turned from the last step's frame to
     * the one it is drawn in. Null when the mesh is not flesh or has not been simulated
     *
     * @param animated Where the animation puts the mesh's vertices now
     * @param back Turns a world direction at the last step into one now
     */
    vertices(key: string, animated: readonly V3[], back: (v: V3) => V3): V3[] | null {
        for (const p of this.parts) {
            for (const r of p.regions) {
                const disp = this.displacements(p, r);

                if (!disp) continue;

                const member = r.members.find(m => m.input.key === key);

                if (member) {
                    return animated.map((v, vertex) => {
                        const particle = member.welded.particleOfVertex[vertex];
                        const at = member.indexOf[particle];

                        return at < 0 ? v : add(v, back(disp[at]));
                    });
                }

                const carried = r.carried.find(c => c.input.key === key);

                if (carried && carried.fit.length > 0) {
                    const move: V3 = [0, 0, 0];

                    for (const k of carried.fit) for (let a = 0; a < 3; a++) move[a] += disp[k][a] / carried.fit.length;

                    const shift = back(move);

                    return animated.map(v => add(v, shift));
                }
            }
        }

        return null;
    }

    /** A line per flesh for the panel: how many vertices it moves, and how far its swing has gone of its limit */
    report(): { name: string; particles: number; swing: number }[] {
        return this.parts.map(p => ({
            name: p.name,
            particles: p.regions.reduce((s, r) => s + r.rest.length, 0),
            swing: Math.max(0, ...p.regions.map(r => Math.hypot(...r.region.lumpShown) / Math.max(1e-9, r.region.limit(p.params)))),
        }));
    }

    /** The turn from the step frame into the frame now: the caller's own {@code qaxisY(entity.yaw - stepYaw)} */
    static turnOf(entityYaw: number, stepYaw: number, v: V3): V3 {
        return qrotate(qaxisY(entityYaw - stepYaw), v);
    }
}

