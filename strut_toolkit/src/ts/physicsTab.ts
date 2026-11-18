/**
 * The Physics tab: a mode beside Edit, Paint and Animate. Pick a bone in the panel's own bone list, turn it into a spring (jiggle) or a chain (hair, tail) with
 * sliders, add colliders and test shapes, and press Simulate to watch the real model move with the same physics the game runs, driven by a scripted motion or
 * by one of the model's own animations. The settings are the JSON the game reads (kept in the project and written into the .strutmodel); this file only wires
 * Blockbench to the tested modules in {@code physics/}: it reads each bone's matrix from three.js, asks {@link PhysicsRig} for new local rotations, and writes
 * them back. Test shapes exist only on this screen: they are three.js meshes in the scene, never elements of the project
 * <p>
 * Everything here that touches Blockbench or three.js needs a live Blockbench to check; the physics it drives is tested
 */
import { PROPERTY_PHYSICS } from './constants';
import { AutoBone, AutoMode, ColliderSpec, generateAutoColliders, isRelated } from './physics/autoColliders';
import {
    addColliderForm, autoModeOf, BoneFilter, boneFilterOf, ColliderForm, collidersOn, setBoneFilter, fitForm, Limits, removeColliderAt, setAutoEnabled, setAutoMode, setSpringLimits, Shape, springLimits,
    updateColliderAt,
} from './physics/colliderEdit';
import {
    autoCollidersOf, chainControls, chainFrom, chainNameOf, CHAIN_DEFAULTS, Doc, fleshEntryName, kindOf, LOOKS, PartControls, PartKind, readDoc,
    fleshControls, fleshLook, FLESH_LOOKS, FleshControls, removePart, setChain, setFlesh, setFleshBones, setSoft, SoftControls, SOFT_LOOKS, softControls, softLook, setSpring, SPRING_DEFAULTS,
    springControls, summarise, withLook, writeDoc,
} from './physics/edit';
import { resolveSpring } from './physics/preview';
import { Q4, qaxisY, qfromEulerDegrees, qrotate, V3 } from './physics/math';
import { cubeGrid, cubeRest } from './physics/cubeMesh';
import { cubeDisplay, groupsByPlace, smoothNormals } from './physics/display';
import { colliderLines, defaultMotionOptions, limitArc, limitCone, MotionKind, MOTIONS, motionAt, Segment } from './physics/motion';
import { BoneFrame, ClothMeshInput, PhysicsRig } from './physics/rig';
import { Placed } from './physics/solvers';
import { checkPhysics, starterPhysics } from './physics/config';
import { History } from './physics/history';
import { CSS } from './physicsPanels';
import { windowComponent, WINDOWS } from './physicsComponents';

const G = globalThis as any;
const MODE_ID = 'strut_physics';
/** Blockbench units per block */
const U = 16;

interface Snapshot { readonly q: any; readonly s: any; readonly p: any }

/** One simulated element as it is drawn: its mesh, which input vertex each point of it follows (null: in order), which points are one place on the surface, and whether the material is ours */
interface ClothDisplay { mesh: any; slots: number[] | null; groupOf: number[]; own: boolean }

/** The faces of a cube in the order the scene's own geometry of it has them */
const CUBE_FACES = ['east', 'west', 'up', 'down', 'south', 'north'];

/** A shape that exists only on this screen, for parts to bump into: an object with a place, a turn and a size, that may sweep back and forth along an axis */
interface PropDef {
    id: number;
    kind: 'sphere' | 'box' | 'capsule' | 'wall';
    /** Blocks, in the scene */
    x: number;
    y: number;
    z: number;
    /** Degrees, about x, y and z (a ball has no turn to show) */
    rx: number;
    ry: number;
    rz: number;
    /** Blocks: a ball's diameter, a block's side, a pole's length, a wall's height */
    size: number;
    /** Slides back and forth along {@code sweepAxis} (world), {@code sweepRange} blocks each way, so a moving thing can be tried against the model */
    sweep: boolean;
    sweepAxis: 'x' | 'y' | 'z';
    sweepRange: number;
    /** Radians a second */
    sweepSpeed: number;
}

interface TreeNode { name: string; depth: number; hasKids: boolean; kind: PartKind; parent: string | null; auto: AutoMode }

const SHAPE_NAMES: Record<Shape, string> = { sphere: 'Sphere', capsule: 'Capsule', box: 'Box' };

/** Everything the panel shows and edits; reactive, shared with the Vue component */
const ui = {
    selected: '' as string,
    /** Every selected bone (the controls act on all of them) and whether they are not all of one type */
    targets: [] as string[],
    mixed: false,
    /** The test shape picked in the panel or the view, or null (a shape and a bone are never both picked) */
    selectedProp: null as number | null,
    kind: 'none' as PartKind,
    controls: { ...SPRING_DEFAULTS } as PartControls,
    /** The picked bone as cloth or flesh */
    soft: softControls({}, '', 'cloth') as SoftControls,
    /** The picked bone as flesh */
    flesh: fleshControls({}, '') as FleshControls,
    fleshLooks: Object.entries(FLESH_LOOKS).map(([id, label]) => ({ id, label })),
    /** Whether the picked bone has a mesh of its own (cloth and flesh are made from one), and the other bones that have meshes */
    hasMesh: false,
    /** The selected bone has a mesh or a cube: what flesh can be made from */
    hasShape: false,
    meshBones: [] as string[],
    softLooks: Object.entries(SOFT_LOOKS).map(([id, l]) => ({ id, label: l.label, kind: l.kind })),
    running: false,
    motion: 'walk' as MotionKind,
    animation: '' as string,
    speed: 1,
    /** The camera while it simulates: free, or held on the model or on the picked bone so the physics can be watched without the move in the way */
    camMode: 'off' as 'off' | 'model' | 'bone',
    /** Which of the move the camera follows: along each axis, and the turning */
    camX: true,
    camY: true,
    camZ: true,
    camTurn: true,
    animations: [] as string[],
    showColliders: true,
    showDebug: true,
    autoColliders: null as boolean | null,
    summary: '',
    problems: [] as string[],
    notice: '',
    query: '',
    tree: [] as TreeNode[],
    open: {} as Record<string, boolean>,
    sections: { test: true, bones: true, feel: true, shapes: false, props: false } as Record<string, boolean>,
    /** Show the description under each setting */
    help: true,
    /** Bones are being picked in the view for a list: which list, and what to tell the user */
    picking: null as { kind: string; text: string; valid: string[] } | null,
    /** The JSON window: the text, whether it is valid and what is wrong with it */
    json: '',
    jsonOk: true,
    jsonStatus: '',
    jsonProblems: [] as string[],
    jsonFocused: false,
    /** Which groups of controls are open, by kind and group */
    groups: {} as Record<string, boolean>,
    /** List only the bones that have physics */
    onlyPhysics: false,
    /** The other bones that have a mesh or a cube: what flesh may pair with or carry */
    shapeBones: [] as string[],
    /** The selected bone's own collision shapes: their places in the document's list, and names */
    shapes: [] as { index: number; label: string }[],
    /** The one being edited, by its place in the document's list, or -1 */
    shapeIndex: -1,
    form: null as ColliderForm | null,
    autoMode: 'auto' as AutoMode,
    limits: { x: null, y: null, z: null } as Limits,
    showLimits: true,
    /** Draw every shape, not only those the selected bone bumps into */
    showAllShapes: false,
    /** The bones with shapes the selected part could bump into, and its allow or deny list */
    candidates: [] as string[],
    filter: { only: [], ignore: [] } as BoneFilter,
    onlyTicked: false,
    props: [] as PropDef[],
    canUndo: false,
    canRedo: false,
    looks: Object.entries(LOOKS).map(([id, l]) => ({ id, label: l.label, kind: l.kind })),
    motions: MOTIONS,
    /** The settings of every move, by move */
    motionOpts: defaultMotionOptions() as Record<string, Record<string, number>>,
};

// ---------------- reading the project ----------------

function groups(): any[] {
    return (G.Group?.all ?? []) as any[];
}

function groupName(node: any): string | null {
    return node && node !== 'root' && typeof node.name === 'string' ? node.name : null;
}

function childGroups(group: any): any[] {
    return (group.children ?? []).filter((c: any) => c instanceof G.Group);
}

/** The names of a bone and every bone under it */
function bonesUnder(name: string): Set<string> {
    const out = new Set<string>();
    const visit = (g: any): void => {
        out.add(g.name);

        for (const k of childGroups(g)) visit(k);
    };
    const root = groups().find(x => x.name === name);

    if (root) visit(root);

    return out;
}

function physicsText(): string {
    return String(G.Project?.[PROPERTY_PHYSICS] ?? '');
}

function savePhysicsText(text: string): void {
    G.Project[PROPERTY_PHYSICS] = text;
    G.Project.saved = false;
}

function selectedGroupName(): string {
    const g = G.Group?.first_selected ?? G.Group?.selected;

    return groupName(g) ?? '';
}

function autoBones(): AutoBone[] {
    const THREE = G.THREE;

    return groups().map((g): AutoBone => {
        const cubes: V3[][] = [];
        const meshVertices: V3[] = [];

        for (const child of g.children ?? []) {
            if (child.export === false) continue;

            if (child instanceof G.Cube) {
                const from = child.from as V3;
                const to = child.to as V3;
                const o = (child.origin ?? [0, 0, 0]) as V3;
                const r = (child.rotation ?? [0, 0, 0]) as V3;
                const euler = new THREE.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'ZYX');
                const corners: V3[] = [];

                for (const x of [from[0], to[0]]) for (const y of [from[1], to[1]]) for (const z of [from[2], to[2]]) {
                    const v = new THREE.Vector3(x - o[0], y - o[1], z - o[2]).applyEuler(euler);

                    corners.push([v.x + o[0], v.y + o[1], v.z + o[2]]);
                }

                cubes.push(corners);
            }
            else if (child instanceof G.Mesh) {
                const o = (child.origin ?? [0, 0, 0]) as V3;

                for (const v of Object.values(child.vertices ?? {}) as V3[]) meshVertices.push([v[0] + o[0], v[1] + o[1], v[2] + o[2]]);
            }
        }

        return { name: g.name, parent: groupName(g.parent), origin: (g.origin ?? [0, 0, 0]) as V3, cubes, meshVertices, hidden: g.export === false };
    });
}

/** The mesh elements of the project, with the bone each is in */
function meshElements(): { element: any; bone: string }[] {
    const out: { element: any; bone: string }[] = [];

    for (const g of groups()) {
        for (const child of g.children ?? []) {
            if (child instanceof G.Mesh && child.export !== false) out.push({ element: child, bone: g.name as string });
        }
    }

    return out;
}

/** The cube elements of the project, with the bone each is in: flesh moves these as meshes (the game cuts them) */
function cubeElements(): { element: any; bone: string }[] {
    const out: { element: any; bone: string }[] = [];

    for (const g of groups()) {
        for (const child of g.children ?? []) {
            if (child instanceof G.Cube && child.export !== false && cubeGrid(child.from as V3, child.to as V3)) out.push({ element: child, bone: g.name as string });
        }
    }

    return out;
}

/** A cube's grid in its own space (relative to its origin, unrotated): the space of its vertices in the scene */
function cubeLocal(element: any): V3[] {
    const o = (element.origin ?? [0, 0, 0]) as V3;
    const from = (element.from as V3).map((v, a) => v - o[a]) as V3;
    const to = (element.to as V3).map((v, a) => v - o[a]) as V3;

    return cubeGrid(from, to)!.local;
}

/** Each mesh as cloth and flesh see it: vertices in blocks in the game's mesh space (the vertex and the mesh's origin, over 16), faces as indices */
function meshInputs(): ClothMeshInput[] {
    const cubes = cubeElements().map(({ element, bone }): ClothMeshInput => {
        const o = (element.origin ?? [0, 0, 0]) as V3;
        const grid = cubeGrid((element.from as V3).map((v, a) => v - o[a]) as V3, (element.to as V3).map((v, a) => v - o[a]) as V3)!;

        return { key: String(element.uuid), bone, rest: cubeRest(grid.local, o, (element.rotation ?? [0, 0, 0]) as V3, U), faces: grid.faces, cube: true };
    });

    return [...meshElements().map(({ element, bone }): ClothMeshInput => {
        const keys = Object.keys(element.vertices ?? {});
        const o = (element.origin ?? [0, 0, 0]) as V3;
        const index = new Map(keys.map((k, i) => [k, i]));

        return {
            key: String(element.uuid),
            bone,
            rest: keys.map((k): V3 => [(element.vertices[k][0] + o[0]) / U, (element.vertices[k][1] + o[1]) / U, (element.vertices[k][2] + o[2]) / U]),
            faces: (Object.values(element.faces ?? {}) as any[]).map(f => (f.vertices as string[]).map(v => index.get(v) ?? 0)).filter(f => f.length >= 3),
        };
    }), ...cubes];
}

// ---------------- the session: rig, pose capture, overlay, simulation loop ----------------

class Session {
    doc: Doc = {};
    rig: PhysicsRig | null = null;
    private snapshots = new Map<string, Snapshot>();
    private overlay: any = null;
    private propMeshes: any[] = [];
    private nextProp = 1;
    private raf = 0;
    private started = 0;
    private modelSnapshot: { p: any; ry: number } | null = null;

    /** Reads the document from the project, rebuilds the rig and redraws */
    reload(): void {
        this.doc = readDoc(physicsText());
        this.rebuild();
        this.refreshSelection();
        this.syncProps();
    }

    rebuild(): void {
        const bones = groups().map(g => ({ name: g.name as string, parent: groupName(g.parent) }));

        this.rig = new PhysicsRig(bones, this.doc, options => generateAutoColliders(autoBones(), options), meshInputs());

        const check = checkPhysics(writeDoc(this.doc), bones.map(b => b.name));

        ui.problems = [...check.warnings, ...this.rig.problems];
        ui.summary = summarise(this.doc);
        this.syncJson();
        ui.autoColliders = autoCollidersOf(this.doc);
        this.refreshTags();
        this.refreshTree();
        this.drawOverlay();
    }

    /**
     * The picked bone's tag, its allow or deny list and the bones it could bump into. Recomputed on every rebuild, not only when a bone is picked: toggling
     * "bumps into its own body" or editing a shape changes what is on offer without changing the selection
     */
    private refreshTags(): void {
        ui.autoMode = ui.selected ? autoModeOf(this.doc, ui.selected) : 'auto';
        ui.candidates = ui.selected && this.rig ? this.rig.candidateBones(ui.selected) : [];
        ui.filter = ui.selected ? boneFilterOf(this.doc, ui.selected) : { only: [], ignore: [] };
        ui.onlyTicked = ui.filter.only.length > 0;
        ui.limits = ui.selected && ui.kind === 'spring' ? springLimits(this.doc, ui.selected) : { x: null, y: null, z: null };
    }

    private readonly history = new History();

    private syncHistory(): void {
        ui.canUndo = this.history.canUndo;
        ui.canRedo = this.history.canRedo;
    }

    /** Forgets the undo steps (another project was opened) */
    clearHistory(): void {
        this.history.clear();
        this.syncHistory();
    }

    /** Notes the text as it is now so an edit made outside this tab (the JSON dialog) can be undone */
    noteExternalEdit(): void {
        this.history.record(physicsText(), 'json', performance.now());
        this.syncHistory();
    }

    undo(): void {
        this.step(this.history.undo(physicsText()));
    }

    redo(): void {
        this.step(this.history.redo(physicsText()));
    }

    private step(text: string | null): void {
        if (text === null) return;

        savePhysicsText(text);
        this.syncHistory();
        this.doc = readDoc(text);

        const was = ui.running;

        this.rebuild();

        if (was) this.rig?.reset();

        this.refreshSelection();
    }

    /** Puts a changed document into the project and the rig (a running simulation carries on with it); {@code key} groups the edits of one control into one undo step */
    commit(doc: Doc, key = 'edit'): void {
        this.history.record(physicsText(), key, performance.now());
        this.syncHistory();
        this.doc = doc;
        savePhysicsText(writeDoc(doc));

        const was = ui.running;

        this.rebuild();

        if (was) this.rig?.reset();
    }

    refreshSelection(): void {
        ui.selected = selectedGroupName();
        ui.targets = ((G.Group?.multi_selected ?? []) as any[]).map(g => groupName(g)).filter((n): n is string => n !== null);

        if (ui.selected && !ui.targets.includes(ui.selected)) ui.targets = [ui.selected, ...ui.targets];

        ui.kind = ui.selected ? kindOf(this.doc, ui.selected) : 'none';
        ui.mixed = ui.targets.some(b => kindOf(this.doc, b) !== ui.kind);

        // a bone and a test shape are never picked together
        if (ui.selected && ui.selectedProp !== null) {
            ui.selectedProp = null;
            this.styleProps();
            this.updateGizmo();
        }

        if (ui.kind === 'spring') ui.controls = springControls(this.doc, ui.selected);
        else if (ui.kind === 'chain') ui.controls = chainControls(this.doc, ui.selected);
        else if (ui.kind === 'cloth') ui.soft = softControls(this.doc, ui.selected, 'cloth');
        else if (ui.kind === 'flesh') ui.flesh = fleshControls(this.doc, ui.selected);

        const withMesh = meshElements().map(m => m.bone);

        const withCube = cubeElements().map(c => c.bone);
        const picked = ui.targets.length > 0 ? ui.targets : ui.selected ? [ui.selected] : [];

        ui.hasMesh = picked.length > 0 && picked.every(b => withMesh.includes(b));
        // flesh may be made from the meshes and cubes of the bones under a bone too (a bone with none of its own is all of what is under it)
        ui.hasShape = picked.length > 0 && picked.every(b => [...bonesUnder(b)].some(u => withMesh.includes(u) || withCube.includes(u)));
        ui.meshBones = [...new Set(withMesh)].filter(b => !picked.includes(b));
        ui.shapeBones = [...new Set([...withMesh, ...withCube])].filter(b => !picked.includes(b));

        this.refreshShapes();
        this.refreshTags();

        ui.animations = ((G.Animation?.all ?? []) as any[]).map(a => a.name as string);

        // the bones above the selection are opened so it can be seen in the list
        const above: Record<string, boolean> = {};

        for (let g = groups().find(x => x.name === ui.selected)?.parent; g && g !== 'root'; g = g.parent) above[g.name] = true;

        if (Object.keys(above).some(k => !ui.open[k])) ui.open = { ...ui.open, ...above };

        this.refreshTree();
        this.drawOverlay();
    }

    /**
     * Only bones are ever selected here: a click on a cube in the view selects the bone it belongs to instead. Selecting a bone in Blockbench also selects the
     * cubes inside it, so a selected element is only a stray when no bone is selected at all; anything else would select the bone again forever
     */
    keepBonesSelected(): boolean {
        if (G.Group?.first_selected ?? G.Group?.selected) return false;

        const stray = ((G.Outliner?.selected ?? []) as any[]).find(n => !(n instanceof G.Group));

        if (!stray) return false;

        if (this.correcting) return true;

        this.correcting = true;

        try {
            const parent = stray.parent;

            if (parent && parent !== 'root') parent.select?.();
            else G.unselectAllElements?.();
        }
        catch { /* the selection changed under us */ }
        finally {
            this.correcting = false;
        }

        return true;
    }

    private correcting = false;
    private refreshQueued = false;

    /** Refreshes the panel once after a burst of selection events, not once per event */
    queueRefresh(): void {
        if (this.refreshQueued) return;

        this.refreshQueued = true;
        requestAnimationFrame(() => {
            this.refreshQueued = false;
            this.refreshSelection();
        });
    }

    /** Picks a bone; with ctrl it is added to (or taken from) the picked ones, with shift every bone of the list between the picked one and it is */
    pick(name: string, event?: MouseEvent): void {
        const g = groups().find(x => x.name === name);

        try {
            if (g && event?.shiftKey && ui.selected) {
                const names = ui.tree.map(n => n.name);
                const from = names.indexOf(ui.selected);
                const to = names.indexOf(name);

                if (from >= 0 && to >= 0) {
                    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) groups().find(x => x.name === names[i])?.multiSelect?.();
                }
            }
            else if (g && (event?.ctrlKey || event?.metaKey)) {
                if (g.selected) g.unselect?.();
                else g.multiSelect?.();
            }
            else {
                g?.select?.();
            }
        }
        catch { /* not selectable right now */ }

        this.queueRefresh();
    }

    // ---- picking in the view ----

    /**
     * A click in the 3D view: the nearest of the bones and the test shapes under the pointer is picked. A bone is the bone of the cube or mesh that was hit (ctrl adds
     * it to the picked ones), as in the Animate tab, since a bone is not an element
     */
    pickInView(preview: any, event: PointerEvent): void {
        let hit: any = false;

        try {
            hit = preview.raycast(event);
        }
        catch { /* nothing to hit */ }

        const boneDistance = hit && hit.type === 'element' && hit.intersects?.[0] ? hit.intersects[0].distance : Infinity;
        const propHit = this.propMeshes.length > 0 ? preview.raycaster?.intersectObjects(this.propMeshes, true)?.[0] : undefined;

        if (propHit && propHit.distance < boneDistance) {
            let node = propHit.object;

            while (node && node.userData?.propId === undefined) node = node.parent;

            if (node) {
                this.selectProp(node.userData.propId);

                return;
            }
        }

        if (G.Transformer?.was_clicked || G.Transformer?.axis) return;

        // while a list is being picked a click on a bone adds or takes the bone, and a click on nothing changes nothing
        if (ui.picking) {
            const picked = hit && hit.type === 'element' ? hit.element?.parent : null;

            if (picked instanceof G.Group) this.pickedBone(picked.name as string);
            else if (ui.picking.kind === 'pair' || ui.picking.kind === 'carry') ui.notice = 'Click a bone that has a mesh or a cube.';

            return;
        }

        if (!hit || hit.type !== 'element') {
            // a click on nothing puts a picked test shape down
            if (ui.selectedProp !== null && !(event.ctrlKey || event.metaKey)) this.selectProp(null);

            return;
        }

        const group = hit.element?.parent;

        if (!(group instanceof G.Group)) return;

        try {
            if ((event.ctrlKey || event.metaKey) && group.selected) group.unselect?.();
            else if (event.ctrlKey || event.metaKey) group.multiSelect?.();
            else group.select?.(event);
        }
        catch { /* not selectable right now */ }

        this.queueRefresh();
    }

    private refreshTree(): void {
        const nodes: TreeNode[] = [];
        const visit = (g: any, depth: number, parent: string | null): void => {
            const kids = childGroups(g);

            nodes.push({ name: g.name, depth, hasKids: kids.length > 0, kind: kindOf(this.doc, g.name), parent, auto: autoModeOf(this.doc, g.name) });

            for (const k of kids) visit(k, depth + 1, g.name);
        };

        for (const n of (G.Outliner?.root ?? []) as any[]) if (n instanceof G.Group) visit(n, 0, null);

        // replaced whole, not added to: a key added to a reactive object does not tell the panel it changed
        const first = nodes.filter(n => ui.open[n.name] === undefined && n.depth < 1);

        if (first.length > 0) ui.open = { ...ui.open, ...Object.fromEntries(first.map(n => [n.name, true])) };

        // frozen so Vue does not build watchers for every bone of a big model on each refresh
        ui.tree = Object.freeze(nodes) as TreeNode[];
    }

    // ---- controls: every edit applies to all the selected bones ----

    /** The bones the controls act on: all the selected ones, or just the picked one */
    targets(): string[] {
        return ui.targets.length > 0 ? ui.targets : ui.selected ? [ui.selected] : [];
    }

    /** The parts of the targets that are of {@code kind}: one per spring bone, chain, cloth or flesh (two bones of one chain are one part). Each is named by one of its bones */
    private partsOf(doc: Doc, kind: PartKind): string[] {
        const seen = new Set<string>();
        const out: string[] = [];

        for (const bone of this.targets()) {
            if (kindOf(doc, bone) !== kind) continue;

            const id = kind === 'chain' ? chainNameOf(doc, bone) : kind === 'flesh' ? fleshEntryName(doc, bone) : bone;

            if (id === null || seen.has(id)) continue;

            seen.add(id);
            out.push(bone);
        }

        return out;
    }

    /** The controls of one part, whatever its kind */
    private controlsOf(doc: Doc, kind: PartKind, bone: string): any {
        switch (kind) {
            case 'spring': return springControls(doc, bone);
            case 'chain': return chainControls(doc, bone);
            case 'cloth': return softControls(doc, bone, 'cloth');
            default: return fleshControls(doc, bone);
        }
    }

    private withControls(doc: Doc, kind: PartKind, bone: string, c: any): Doc {
        switch (kind) {
            case 'spring': return setSpring(doc, bone, c);
            case 'chain': {
                const name = chainNameOf(doc, bone);

                return name === null ? doc : setChain(doc, doc.chains[name].bones, c);
            }
            case 'cloth': return setSoft(doc, bone, 'cloth', c);
            default: return setFlesh(doc, bone, c);
        }
    }

    /** Changes the controls of every selected part of the picked kind, each from its own, and puts the result in the project as one undo step */
    edit(change: (c: any, bone: string) => any, key: string): void {
        const kind = ui.kind;

        if (kind === 'none') return;

        let doc = this.doc;

        for (const bone of this.partsOf(doc, kind)) doc = this.withControls(doc, kind, bone, change(this.controlsOf(doc, kind, bone), bone));

        if (doc !== this.doc) this.commit(doc, `${key}:${this.targets().join(',')}`);
    }

    /** The picked part's controls on screen, whatever its kind */
    private model(): any {
        return ui.kind === 'flesh' ? ui.flesh : ui.kind === 'cloth' ? ui.soft : ui.controls;
    }

    /** One number or tick of the controls, for every selected part */
    setField(key: string, value: number | boolean | string | string[]): void {
        this.model()[key] = value;
        this.edit(c => ({ ...c, [key]: value }), `field:${key}`);
    }

    /** Changes some of a flesh's controls together, for every selected flesh */
    setFleshPatch(patch: Partial<FleshControls>): void {
        ui.flesh = { ...ui.flesh, ...patch };
        this.edit(c => ({ ...c, ...patch }), `patch:${Object.keys(patch).join('+')}`);
    }

    /** A look on every selected part: it sets the numbers, and keeps what is the bone's own (its zone, the pieces it carries, its collisions, its bones) */
    applyAnyLook(look: string): void {
        const kind = ui.kind;

        this.edit((c, bone) => {
            if (kind === 'flesh') {
                const next = fleshLook(look, bone);

                return {
                    ...next, softCenter: c.softCenter, softRadius: c.softRadius, carry: c.carry, collideBody: c.collideBody, collideWorld: c.collideWorld, collideOthers: c.collideOthers,
                    bones: c.bones, nestedSoft: c.nestedSoft, pivotMode: c.pivotMode, pivot: c.pivot, tip: c.tip, up: c.up, presses: c.presses,
                };
            }

            if (kind === 'cloth') return { ...softLook(look, bone), softCenter: c.softCenter, softRadius: c.softRadius, carry: c.carry };

            return withLook(c, look);
        }, `look:${look}:${performance.now()}`);
        this.refreshSelection();
    }

    /** Puts each soft zone at the middle of its own bone's meshes, with half their reach as the radius */
    zoneFromMesh(): void {
        const inputs = meshInputs();
        let missing = false;

        this.edit((c, bone) => {
            const own = inputs.filter(m => m.bone === bone);
            // a flesh with no mesh of its own is all of what is under it
            const under = bonesUnder(bone);
            const all = (own.length > 0 || ui.kind !== 'flesh' ? own : inputs.filter(m => under.has(m.bone))).flatMap(m => m.rest);

            if (all.length === 0) {
                missing = true;

                return c;
            }

            const lo: V3 = [Infinity, Infinity, Infinity];
            const hi: V3 = [-Infinity, -Infinity, -Infinity];

            for (const v of all) for (let a = 0; a < 3; a++) {
                lo[a] = Math.min(lo[a], v[a]);
                hi[a] = Math.max(hi[a], v[a]);
            }

            return {
                ...c, softCenter: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
                softRadius: Math.max(0.05, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 4),
            };
        }, `zone:${performance.now()}`);

        if (missing) ui.notice = 'No mesh to take a soft zone from.';

        this.refreshSelection();
    }

    setCentre(axis: number, value: number): void {
        const centre = [...this.model().softCenter] as V3;

        centre[axis] = value;
        this.model().softCenter = centre;
        this.edit(c => {
            const next = [...c.softCenter] as V3;

            next[axis] = value;

            return { ...c, softCenter: next };
        }, `centre:${axis}`);
    }

    /** Ticks or unticks a bone whose meshes ride on every selected part */
    toggleCarry(bone: string, on: boolean): void {
        const carry = this.model().carry.filter((b: string) => b !== bone);

        if (on) carry.push(bone);

        this.model().carry = carry;
        this.edit(c => ({ ...c, carry: on ? [...c.carry.filter((b: string) => b !== bone), bone] : c.carry.filter((b: string) => b !== bone) }), `carry:${bone}`);
    }

    /** Pairs the picked flesh with another bone (or makes it one bone again): a pair presses on each other */
    setFleshPartner(other: string): void {
        if (!ui.selected || ui.kind !== 'flesh' || this.targets().length > 1) return;

        const bones = ui.flesh.bones;
        const second = bones.indexOf(ui.selected) === 1;
        const first = second ? bones[0] : ui.selected;
        const next = other ? (second ? [other, ui.selected] : [first, other]) : [first];

        this.commit(setFleshBones(this.doc, ui.selected, next), `pair:${ui.selected}`);
        this.refreshSelection();
    }

    setKind(kind: PartKind): void {
        const names = this.targets();

        if (names.length === 0 || (kind === ui.kind && !ui.mixed)) return;

        ui.notice = '';

        const withMesh = new Set(meshElements().map(m => m.bone));
        const withShape = new Set([...withMesh, ...cubeElements().map(c => c.bone)]);
        const left: string[] = [];
        let doc = this.doc;

        for (const name of names) {
            if (kindOf(doc, name) === kind) continue;

            if (kind === 'none') {
                doc = removePart(doc, name);
            }
            else if (kind === 'spring') {
                doc = setSpring(removePart(doc, name), name, withLook(SPRING_DEFAULTS, 'jiggle-soft'));
            }
            else if (kind === 'cloth' || kind === 'flesh') {
                if (kind === 'cloth' ? !withMesh.has(name) : ![...bonesUnder(name)].some(u => withShape.has(u))) {
                    left.push(name);

                    continue;
                }

                doc = kind === 'cloth' ? setSoft(removePart(doc, name), name, 'cloth', softLook('cloth', name)) : setFlesh(removePart(doc, name), name, fleshLook('pouch', name));
            }
            else {
                const bones = chainFrom(name, n => childGroups(groups().find(x => x.name === n)).map(c => c.name as string));

                if (names.length === 1) ui.notice = bones.length === 1 ? 'This bone has no child bones, so the chain is only its tip. A chain needs child bones to swing along.' : `Chain of ${bones.length} bones: ${bones.join(' > ')}`;

                doc = setChain(removePart(doc, name), bones, withLook(CHAIN_DEFAULTS, 'hair'));
            }
        }

        if (left.length > 0) {
            ui.notice = kind === 'cloth' ? `No mesh on ${left.join(', ')}. Cloth is made from the vertices of a mesh, not from cubes.` : `No mesh or cube on ${left.join(', ')} to make flesh from.`;
        }

        if (doc !== this.doc) this.commit(doc, `kind:${names.join(',')}`);

        this.refreshSelection();
    }

    setAuto(value: boolean | null): void {
        this.commit(setAutoEnabled(this.doc, value), 'auto');
    }

    // ---- the selected bone's collision shapes ----

    /** Lists the selected bone's own shapes and keeps the one being edited if it is still there */
    private refreshShapes(): void {
        const own = ui.selected ? collidersOn(this.doc, ui.selected) : [];
        const counts: Record<string, number> = {};

        ui.shapes = own.map(c => {
            counts[c.form.shape] = (counts[c.form.shape] ?? 0) + 1;

            return { index: c.index, label: `${SHAPE_NAMES[c.form.shape]} ${counts[c.form.shape]}` };
        });

        if (!own.some(c => c.index === ui.shapeIndex)) ui.shapeIndex = own.length > 0 ? own[0].index : -1;

        ui.form = own.find(c => c.index === ui.shapeIndex)?.form ?? null;
    }

    selectShape(index: number): void {
        ui.shapeIndex = index;
        this.refreshShapes();
        this.drawOverlay();
    }

    /** Adds a shape to the selected bone, already fitted around the bone's own cubes */
    addShape(shape: Shape): void {
        if (!ui.selected) return;

        const added = addColliderForm(this.doc, ui.selected, fitForm(shape, autoBones().find(b => b.name === ui.selected)));

        ui.shapeIndex = added.index;
        this.commit(added.doc, `shape:${performance.now()}`);
        this.refreshSelection();
    }

    /** One number of the shape being edited: {@code key} is the field, {@code axis} its component for a vector */
    setShapeValue(key: 'center' | 'size' | 'rotation' | 'radius' | 'length', axis: number, value: number): void {
        if (!ui.form || ui.shapeIndex < 0 || !Number.isFinite(value)) return;

        const form: ColliderForm = { ...ui.form, center: [...ui.form.center], size: [...ui.form.size], rotation: [...ui.form.rotation] };

        if (key === 'radius' || key === 'length') form[key] = value;
        else form[key][axis] = value;

        ui.form = form;
        this.commit(updateColliderAt(this.doc, ui.shapeIndex, form), `collider:${ui.shapeIndex}:${key}${axis}`);
        this.refreshShapes();
    }

    setShapeKind(shape: Shape): void {
        if (!ui.form || ui.form.shape === shape) return;

        const fitted = fitForm(shape, autoBones().find(b => b.name === ui.selected));

        this.commit(updateColliderAt(this.doc, ui.shapeIndex, { ...fitted, center: ui.form.center }), `collider:${ui.shapeIndex}:kind`);
        this.refreshShapes();
    }

    fitShape(): void {
        if (!ui.form) return;

        this.commit(updateColliderAt(this.doc, ui.shapeIndex, fitForm(ui.form.shape, autoBones().find(b => b.name === ui.selected))), `collider:${performance.now()}`);
        this.refreshShapes();
    }

    duplicateShape(): void {
        if (!ui.form || !ui.selected) return;

        const moved: ColliderForm = { ...ui.form, center: [ui.form.center[0] + 1, ui.form.center[1], ui.form.center[2]] };
        const added = addColliderForm(this.doc, ui.selected, moved);

        ui.shapeIndex = added.index;
        this.commit(added.doc, `shape:${performance.now()}`);
        this.refreshShapes();
    }

    deleteShape(): void {
        if (ui.shapeIndex < 0) return;

        this.commit(removeColliderAt(this.doc, ui.shapeIndex), `shape:${performance.now()}`);
        ui.shapeIndex = -1;
        this.refreshShapes();
    }

    setMode(mode: AutoMode): void {
        const names = this.targets();

        if (names.length === 0) return;

        let doc = this.doc;

        for (const name of names) doc = setAutoMode(doc, name, mode);

        this.commit(doc, `mode:${names.join(',')}:${performance.now()}`);
        ui.autoMode = mode;
    }

    // ---- which of its own bones the selected parts bump into ----

    /** Whether the picked part bumps into the shapes of {@code bone} (by its allow and deny lists) */
    isTicked(bone: string): boolean {
        return ui.filter.only.length > 0 ? ui.filter.only.includes(bone) : !ui.filter.ignore.includes(bone);
    }

    /** Puts one allow or deny list on every selected part */
    private setFilter(filter: BoneFilter): void {
        let doc = this.doc;

        for (const name of this.targets()) doc = setBoneFilter(doc, name, filter);

        this.commit(doc, `filter:${performance.now()}`);
    }

    /** The bones it bumps into, as the shortest list that says it: nothing written when it is all of them, an allow list when it is a few, a deny list otherwise */
    private setCollideSet(keep: string[]): void {
        const all = ui.candidates;
        const filter: BoneFilter = keep.length >= all.length ? { only: [], ignore: [] }
            : keep.length > 0 && keep.length <= all.length / 2 ? { only: keep, ignore: [] } : { only: [], ignore: all.filter(b => !keep.includes(b)) };

        this.setFilter(filter);
        this.refreshSelection();
    }

    tick(bone: string, ticked: boolean): void {
        if (!ui.selected) return;

        this.setCollideSet(ui.candidates.filter(b => (b === bone ? ticked : this.isTicked(b))));
    }

    setCollide(how: 'all' | 'none' | 'invert'): void {
        if (!ui.selected) return;

        this.setCollideSet(how === 'all' ? [...ui.candidates] : how === 'none' ? [] : ui.candidates.filter(b => !this.isTicked(b)));
    }

    // ---- picking bones in the view for a list ----

    startPicking(kind: string): void {
        const text: Record<string, string> = {
            collide: 'Click bones in the view to add or remove them from what it reacts to.',
            carry: 'Click bones in the view to add or remove them from the pieces that ride on it.',
            pair: 'Click the bone in the view to pair it with.',
        };

        // the bones that can be picked for this list: the rest are greyed out in the Bones window and do nothing in the view
        const valid = kind === 'collide' ? [...ui.candidates] : kind === 'carry' && ui.kind === 'cloth' ? [...ui.meshBones] : [...ui.shapeBones];

        ui.picking = { kind, text: `${text[kind] ?? 'Click bones.'} Click them in the view or in the Bones window; the greyed ones cannot be picked here. Esc or Done when finished.`, valid };
        ui.notice = '';
        this.drawOverlay();
    }

    /** Why {@code bone} cannot go in the list being picked: what the user needs to know to make it so */
    whyNot(kind: string | undefined, bone: string): string {
        const info = autoBones().find(b => b.name === bone);
        const hasGeometry = !!info && (info.cubes.length > 0 || info.meshVertices.length > 0);

        if (!hasGeometry) return kind === 'collide' ? 'has no cubes or meshes, so it has no shape for this to react to.' : 'has no mesh or cube.';

        if (kind !== 'collide') return 'cannot be picked here.';

        const parents = new Map(groups().map(g => [g.name as string, groupName(g.parent)] as [string, string | null]));

        if (this.targets().some(t => isRelated(bone, t, parents))) {
            return 'is above or below this part in the bone tree, so the shape made from it is left out: a part does not bump into what it is built on. Give it a shape of your own in Shapes to use it.';
        }

        if (autoModeOf(this.doc, bone) === 'off') return 'has its shape switched off in Shapes.';

        return 'has no shape for this part to react to (turn on Make shapes from the model in Shapes, or give it a shape of your own).';
    }

    /** The bones in the list being picked for now */
    pickedList(): string[] {
        const kind = ui.picking?.kind;

        return kind === 'collide' ? ui.candidates.filter(b => this.isTicked(b)) : kind === 'carry' ? [...(ui.kind === 'cloth' ? ui.soft : ui.flesh).carry]
            : kind === 'pair' ? ui.flesh.bones.filter(b => b !== ui.selected) : [];
    }

    /** A row of the Bones window clicked while picking */
    pickRow(bone: string): void {
        if (ui.picking) this.pickedBone(bone);
    }

    stopPicking(): void {
        ui.picking = null;
        this.drawOverlay();
    }

    /** A bone was clicked in the view while a list is being picked */
    private pickedBone(bone: string): void {
        const kind = ui.picking?.kind;

        if (!ui.picking?.valid.includes(bone)) {
            ui.notice = `${bone} ${this.whyNot(kind, bone)}`;

            return;
        }

        if (kind === 'collide') {
            this.tick(bone, !this.isTicked(bone));
        }
        else if (kind === 'carry') {
            const list: string[] = (ui.kind === 'cloth' ? ui.soft : ui.flesh).carry;

            if (!this.targets().includes(bone)) this.toggleCarry(bone, !list.includes(bone));
        }
        else if (kind === 'pair') {
            if (bone !== ui.selected) this.setFleshPartner(bone);

            ui.picking = null;
        }

        this.drawOverlay();
    }

    // ---- the bone list ----

    expandAll(open: boolean): void {
        ui.open = Object.fromEntries(ui.tree.map(n => [n.name, open]));
    }

    /** Picks every bone that has physics */
    pickPhysics(): void {
        const names = ui.tree.filter(n => n.kind !== 'none').map(n => n.name);

        try {
            names.forEach((name, i) => {
                const g = groups().find(x => x.name === name);

                if (i === 0) g?.select?.();
                else g?.multiSelect?.();
            });
        }
        catch { /* not selectable right now */ }

        this.queueRefresh();
    }

    pickNone(): void {
        try {
            G.unselectAllElements?.();
        }
        catch { /* nothing was picked */ }

        this.queueRefresh();
    }

    // ---- the JSON window ----

    private jsonTimer = 0;

    /** Shows the model's physics as text, unless the text is being typed in */
    syncJson(force = false): void {
        if (!force && ui.jsonFocused) return;

        const text = physicsText();

        try {
            ui.json = text.trim() ? JSON.stringify(JSON.parse(text), null, 2) : '{\n  "bones": {}\n}';
        }
        catch {
            ui.json = text;
        }

        this.checkJson(ui.json);
    }

    private checkJson(text: string): boolean {
        const check = checkPhysics(text, groups().map(g => g.name as string));

        ui.jsonOk = check.document !== null && check.warnings.length === 0;
        ui.jsonProblems = check.document === null ? [] : [...check.warnings];
        ui.jsonStatus = check.document === null ? 'Not valid JSON yet' : check.warnings.length === 0
            ? `OK: ${check.bones} bones, ${check.chains} chains, ${check.colliders} colliders` : `${check.warnings.length} problem${check.warnings.length === 1 ? '' : 's'}`;

        return check.document !== null;
    }

    jsonFocus(on: boolean): void {
        ui.jsonFocused = on;

        // typing stops: what was typed is laid out as the game's text now
        if (!on) {
            this.applyJson();
            this.syncJson(true);
        }
    }

    /** Text typed in the window: it is applied after a pause, when it is valid */
    editJson(text: string): void {
        ui.json = text;
        this.checkJson(text);
        clearTimeout(this.jsonTimer);
        this.jsonTimer = window.setTimeout(() => this.applyJson(), 700);
    }

    private applyJson(): void {
        clearTimeout(this.jsonTimer);

        if (!this.checkJson(ui.json)) return;

        const doc = readDoc(ui.json);

        if (writeDoc(doc) !== physicsText()) this.commit(doc, 'json');
    }

    formatJson(): void {
        try {
            ui.json = JSON.stringify(JSON.parse(ui.json), null, 2);
            this.checkJson(ui.json);
        }
        catch {
            ui.notice = 'The text is not valid JSON, so it cannot be laid out yet.';
        }
    }

    revertJson(): void {
        clearTimeout(this.jsonTimer);
        this.syncJson(true);
    }

    fillJson(): void {
        ui.json = starterPhysics(groups().map(g => g.name as string));
        this.applyJson();
        this.syncJson(true);
    }

    // ---- limits ----

    /** Changes the angle limits of every selected spring bone, each from its own */
    private editLimits(change: (limits: Limits) => Limits, key: string): void {
        let doc = this.doc;

        for (const name of this.targets()) {
            if (kindOf(doc, name) === 'spring') doc = setSpringLimits(doc, name, change(springLimits(doc, name)));
        }

        this.commit(doc, key);
        this.refreshSelection();
    }

    toggleLimit(axis: 'x' | 'y' | 'z', on: boolean): void {
        if (!ui.selected || ui.kind !== 'spring') return;

        this.editLimits(l => ({ ...l, [axis]: on ? [-30, 30] : null }), `limits:${performance.now()}`);
    }

    setLimit(axis: 'x' | 'y' | 'z', end: 0 | 1, value: number): void {
        if (!ui.selected || !Number.isFinite(value) || !ui.limits[axis]) return;

        this.editLimits(l => {
            const current = l[axis];

            if (!current) return l;

            const next: [number, number] = [current[0], current[1]];

            next[end] = value;

            return { ...l, [axis]: next };
        }, `limits:${this.targets().join(',')}:${axis}${end}`);
    }

    poke(): void {
        if (!ui.running || !ui.selected || !this.rig) return;

        const a = Math.random() * Math.PI * 2;

        this.rig.impulse(ui.selected, [Math.cos(a) * 3, 1.5, Math.sin(a) * 3]);
    }

    // ---- test shapes (never part of the project) ----

    addProp(kind: PropDef['kind']): void {
        const frame = ui.selected ? this.captureFrames().get(ui.selected) : undefined;
        const at: V3 = frame ? [frame.origin[0] + 0.45, frame.origin[1], frame.origin[2]] : [0.6, 0.8, 0];

        const id = this.nextProp++;

        ui.props.push({
            id, kind, x: at[0], y: at[1], z: at[2], rx: 0, ry: 0, rz: 0, size: kind === 'wall' ? 1.5 : kind === 'capsule' ? 1.2 : 0.5, sweep: false, sweepAxis: 'x', sweepRange: 0.7, sweepSpeed: 2.2,
        });
        this.syncProps();
        this.selectProp(id);
    }

    duplicateProp(id: number): void {
        const p = ui.props.find(x => x.id === id);

        if (!p) return;

        const copy: PropDef = { ...p, id: this.nextProp++, x: p.x + 0.3 };

        ui.props.push(copy);
        this.syncProps();
        this.selectProp(copy.id);
    }

    removeProp(id: number): void {
        ui.props = ui.props.filter(p => p.id !== id);

        if (ui.selectedProp === id) ui.selectedProp = null;

        this.syncProps();
        this.updateGizmo();
    }

    clearProps(): void {
        ui.props = [];
        ui.selectedProp = null;
        this.syncProps();
        this.updateGizmo();
    }

    /** Picks a test shape (or none) in the panel or the view: it gets the move gizmo, and no bone stays picked */
    selectProp(id: number | null): void {
        ui.selectedProp = id;

        if (id !== null) {
            try {
                G.unselectAllElements?.();
            }
            catch { /* nothing was picked */ }

            ui.selected = '';
            ui.targets = [];
            ui.kind = 'none';
        }

        this.styleProps();
        this.updateGizmo();
        this.queueRefresh();
    }

    /** Shows the picked test shape brighter than the others */
    styleProps(): void {
        for (const m of this.propMeshes) {
            const picked = m.userData.propId === ui.selectedProp;
            const material = m.userData.material;

            if (!material) continue;

            material.color.setHex(picked ? 0xffe066 : 0xffaa33);
            material.opacity = picked ? 0.6 : 0.35;
        }

        this.render();
    }

    /** Puts the move gizmo at the picked test shape (or takes it away) */
    updateGizmo(): void {
        try {
            G.Transformer?.updateSelection?.();
        }
        catch { /* the view is not ready */ }

        this.render();
    }

    /** Where the picked test shape is in the scene (pixels), for the gizmo */
    propPosition(): any {
        const mesh = this.propMeshes.find(m => m.userData.propId === ui.selectedProp);

        return mesh ? mesh.position : null;
    }

    /** How far a test shape is from where it is set, at time {@code t}: its sweep (held where it was while the gizmo has it) */
    private offsetOf(p: PropDef, t: number): V3 {
        if (this.frozen && this.frozen.id === p.id) return this.frozen.offset;

        const out: V3 = [0, 0, 0];

        if (p.sweep) out['xyz'.indexOf(p.sweepAxis)] = Math.sin(t * p.sweepSpeed) * p.sweepRange;

        return out;
    }

    private frozen: { id: number; offset: V3 } | null = null;
    private simTime = 0;

    /** The physics shape of a test shape at time {@code t}, in blocks */
    private propShape(p: PropDef, t: number): Placed {
        const off = this.offsetOf(p, t);
        const c: V3 = [p.x + off[0], p.y + off[1], p.z + off[2]];
        const turn = qfromEulerDegrees([p.rx, p.ry, p.rz]);
        const axes = [qrotate(turn, [1, 0, 0]), qrotate(turn, [0, 1, 0]), qrotate(turn, [0, 0, 1])];

        switch (p.kind) {
            case 'sphere':
                return { shape: 'sphere', p: c, q: [0, 0, 0], radius: p.size / 2, half: [0, 0, 0], axes };
            case 'capsule': {
                const r = p.size * 0.15;
                const half = Math.max(0, p.size / 2 - r);
                const along = axes[1];

                return {
                    shape: 'capsule', p: [c[0] - along[0] * half, c[1] - along[1] * half, c[2] - along[2] * half], q: [c[0] + along[0] * half, c[1] + along[1] * half, c[2] + along[2] * half],
                    radius: r, half: [0, 0, 0], axes,
                };
            }
            case 'wall':
                return { shape: 'box', p: c, q: [0, 0, 0], radius: 0, half: [p.size * 0.6, p.size / 2, 0.04], axes };
            default:
                return { shape: 'box', p: c, q: [0, 0, 0], radius: 0, half: [p.size / 2, p.size / 2, p.size / 2], axes };
        }
    }

    private clearPropMeshes(): void {
        for (const m of this.propMeshes) {
            m.parent?.remove(m);
            m.traverse?.((o: any) => {
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
        }

        this.propMeshes = [];
    }

    /** Rebuilds the meshes of the test shapes (drawn in the scene, not the project) and hands their shapes to the rig */
    syncProps(): void {
        this.clearPropMeshes();

        if (G.Mode?.selected?.id === MODE_ID && G.THREE && G.Canvas?.scene) {
            const THREE = G.THREE;

            for (const p of ui.props) {
                const material = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.35, depthWrite: false });
                let mesh: any;

                if (p.kind === 'sphere') {
                    mesh = new THREE.Mesh(new THREE.SphereGeometry(p.size / 2 * U, 24, 16), material);
                }
                else if (p.kind === 'capsule') {
                    const r = p.size * 0.15 * U;
                    const len = Math.max(0, p.size * U - 2 * r);

                    mesh = new THREE.Group();
                    mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), material));

                    for (const s of [-1, 1]) {
                        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), material);

                        cap.position.y = s * len / 2;
                        mesh.add(cap);
                    }
                }
                else {
                    const [w, h, d] = p.kind === 'wall' ? [p.size * 1.2, p.size, 0.08] : [p.size, p.size, p.size];

                    mesh = new THREE.Mesh(new THREE.BoxGeometry(w * U, h * U, d * U), material);
                }

                mesh.userData.propId = p.id;
                mesh.userData.material = material;
                mesh.renderOrder = 9000;
                G.Canvas.scene.add(mesh);
                this.propMeshes.push(mesh);
            }
        }

        this.placePropMeshes(0);

        if (this.rig) this.rig.props = ui.props.map(p => this.propShape(p, 0));

        this.styleProps();
    }

    private placePropMeshes(t: number): void {
        for (const m of this.propMeshes) {
            const p = ui.props.find(x => x.id === m.userData.propId);

            if (!p) continue;

            const off = this.offsetOf(p, t);

            m.position.set((p.x + off[0]) * U, (p.y + off[1]) * U, (p.z + off[2]) * U);
            m.rotation.order = 'ZYX';
            m.rotation.set(p.rx * Math.PI / 180, p.ry * Math.PI / 180, p.rz * Math.PI / 180);
        }
    }

    /** The picked test shape's object in the scene, for the gizmo's axes */
    propObject(): any {
        return this.propMeshes.find(m => m.userData.propId === ui.selectedProp) ?? null;
    }

    /** The gizmo takes hold of the picked test shape: a sweeping one stays where it is until it is let go */
    beginDrag(): void {
        const p = ui.props.find(x => x.id === ui.selectedProp);

        if (p) this.frozen = { id: p.id, offset: this.offsetOf(p, this.simTime) };
    }

    /** The gizmo moved, turned or scaled the picked test shape: {@code amount} is in blocks, degrees or a share of its size */
    dragProp(tool: string, axis: string, amount: number): void {
        const p = ui.props.find(x => x.id === ui.selectedProp);

        if (!p || !Number.isFinite(amount)) return;

        if (tool === 'rotate_tool') {
            if (!['x', 'y', 'z'].includes(axis) || Math.abs(amount) > 120) return;

            const key = ('r' + axis) as 'rx' | 'ry' | 'rz';

            p[key] = Math.round(((p[key] + amount + 540) % 360 - 180) * 1000) / 1000;
        }
        else if (tool === 'resize_tool') {
            p.size = Math.max(0.05, Math.min(6, p.size * (1 + amount)));
        }
        else if (['x', 'y', 'z'].includes(axis)) {
            p[axis as 'x' | 'y' | 'z'] += amount / U;
        }

        this.refreshProps();
    }

    /** The gizmo let go: the shape's sweep carries on from where it is, not from where its centre was */
    endDrag(): void {
        const frozen = this.frozen;

        this.frozen = null;

        const p = frozen ? ui.props.find(x => x.id === frozen.id) : undefined;

        if (p && frozen) {
            const now = this.offsetOf(p, this.simTime);

            p.x += frozen.offset[0] - now[0];
            p.y += frozen.offset[1] - now[1];
            p.z += frozen.offset[2] - now[2];
        }

        this.refreshProps();
    }

    /** Puts the test shapes where they are now: in the scene, in the physics and under the gizmo */
    refreshProps(): void {
        this.placePropMeshes(this.simTime);

        if (this.rig) this.rig.props = ui.props.map(x => this.propShape(x, this.simTime));

        this.updateGizmo();
    }

    /** Puts the gizmo back where the picked test shape is, if it was lost or the shape moved (a sweeping one, or one moved from the panel) */
    keepGizmo(): void {
        const T = G.Transformer;

        if (ui.selectedProp === null || G.Mode?.selected?.id !== MODE_ID || !T || T.dragging) return;

        const at = this.propPosition();

        if (!at) return;

        try {
            if (!T.visible || !T.position.equals(at)) T.center();
        }
        catch { /* the view is not ready */ }
    }

    // ---- pose ----

    private captureFrames(): Map<string, BoneFrame> {
        const THREE = G.THREE;
        const frames = new Map<string, BoneFrame>();
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();

        for (const g of groups()) {
            const mesh = g.mesh;

            if (!mesh) continue;

            mesh.matrixWorld.decompose(p, q, s);
            frames.set(g.name, {
                origin: [p.x / U, p.y / U, p.z / U],
                orientation: [q.x, q.y, q.z, q.w],
                local: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
            });
        }

        return frames;
    }

    private snapshot(): void {
        this.snapshots.clear();

        for (const g of groups()) {
            if (g.mesh) this.snapshots.set(g.name, { q: g.mesh.quaternion.clone(), s: g.mesh.scale.clone(), p: g.mesh.position.clone() });
        }
    }

    private restore(): void {
        for (const g of groups()) {
            const snap = this.snapshots.get(g.name);

            if (g.mesh && snap) {
                g.mesh.quaternion.copy(snap.q);
                g.mesh.scale.copy(snap.s);
                g.mesh.position.copy(snap.p);
            }
        }
    }

    private render(): void {
        try {
            for (const preview of (G.Preview?.all ?? []) as any[]) preview.render?.();
        }
        catch { /* a preview that is not ready yet */ }
    }

    // ---- overlay ----

    private ensureOverlay(): any {
        if (this.overlay || !G.THREE || !G.Canvas?.scene) return this.overlay;

        const THREE = G.THREE;
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });

        this.overlay = new THREE.LineSegments(geometry, material);
        this.overlay.renderOrder = 10000;
        this.overlay.frustumCulled = false;
        G.Canvas.scene.add(this.overlay);

        return this.overlay;
    }

    private removeOverlay(): void {
        if (!this.overlay) return;

        this.overlay.parent?.remove(this.overlay);
        this.overlay.geometry?.dispose();
        this.overlay.material?.dispose();
        this.overlay = null;
    }

    /** Draws the colliders, and the springs and chains as lines, at the pose the model is in now */
    drawOverlay(): void {
        if (!this.rig || G.Mode?.selected?.id !== MODE_ID) return;

        const overlay = this.ensureOverlay();

        if (!overlay) return;

        const frames = this.captureFrames();

        if (!ui.running) this.rig.observe(frames);

        const positions: number[] = [];
        const colors: number[] = [];
        const push = (s: Segment, rgb: number): void => {
            for (const v of s) {
                positions.push(v[0] * U, v[1] * U, v[2] * U);
                colors.push(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255);
            }
        };

        if (ui.showColliders) {
            const rig = this.rig;
            const part = ui.selected ? rig.partOf(ui.selected) : null;
            // with a bone picked, only what matters to it: for a spring or chain the shapes it bumps into, for any other bone the shapes it carries
            const shown = (spec: ColliderSpec, generated: boolean): boolean => ui.showAllShapes || !ui.selected || spec.bone === ui.selected
                || (part !== null && rig.feels(ui.selected, spec, generated));

            for (const spec of rig.madeColliders()) {
                const f = frames.get(spec.bone);

                if (f && shown(spec, true)) for (const seg of colliderLines(spec, f)) push(seg, spec.bone === ui.selected ? 0x7fe6ff : 0x2f8fa6);
            }

            (Array.isArray(this.doc.colliders) ? this.doc.colliders : []).forEach((c: any, index: number) => {
                const f = c ? frames.get(c.bone) : undefined;

                if (!f) return;

                const spec: ColliderSpec = {
                    bone: c.bone, shape: c.shape, a: c.center ?? c.from ?? [0, 0, 0], b: c.size ?? c.to ?? [0, 0, 0], radius: c.radius ?? 0, layer: c.layer ?? 'body',
                    ...(Array.isArray(c.rotation) ? { rotation: c.rotation } : {}),
                };
                if (!shown(spec, false)) return;

                const colour = index === ui.shapeIndex && c.bone === ui.selected ? 0xffffff : c.bone === ui.selected ? 0xffd040 : 0xb08a20;

                for (const seg of colliderLines(spec, f)) push(seg, colour);
            });
        }

        if (ui.showLimits && ui.selected) {
            const f = frames.get(ui.selected);

            if (ui.kind === 'spring' && f) {
                const r = resolveSpring(this.doc.bones?.[ui.selected] ?? {});
                const lever: V3 = [r.params.tip[0] * r.params.length, r.params.tip[1] * r.params.length, r.params.tip[2] * r.params.length];
                const colours = [0xff5050, 0x50e050, 0x5080ff];

                (['x', 'y', 'z'] as const).forEach((axis, i) => {
                    const range = ui.limits[axis];

                    if (range) for (const seg of limitArc(f, lever, i as 0 | 1 | 2, range[0], range[1])) push(seg, colours[i]);
                });
            }

            if (ui.kind === 'chain') {
                const chain = this.rig.chainSegments(ui.selected);

                if (chain) for (const [a, b] of chain.segments) for (const seg of limitCone(a, b, chain.maxAngle)) push(seg, 0xc080ff);
            }
        }

        if (ui.picking) {
            const listed = this.pickedList();

            for (const bone of listed) {
                const o = frames.get(bone)?.origin;

                if (!o) continue;

                const s = 0.06;

                push([[o[0] - s, o[1], o[2]], [o[0] + s, o[1], o[2]]], 0x40ffa0);
                push([[o[0], o[1] - s, o[2]], [o[0], o[1] + s, o[2]]], 0x40ffa0);
                push([[o[0], o[1], o[2] - s], [o[0], o[1], o[2] + s]], 0x40ffa0);
            }
        }

        if (ui.showDebug) {
            for (const l of this.rig.debugLines()) push([l.a, l.b], l.kind === 'rest' ? 0x40e040 : 0xf04040);
        }

        const THREE = G.THREE;

        overlay.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        overlay.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        overlay.geometry.computeBoundingSphere?.();
        this.render();
    }

    // ---- simulation ----

    start(): void {
        if (!this.rig || ui.running) return;

        try {
            G.Canvas.updateAllBones?.();
            this.snapshot();

            const model = G.Project?.model_3d;

            this.modelSnapshot = model ? { p: model.position.clone(), ry: model.rotation.y } : null;
            this.rig.reset();
            ui.running = true;
            ui.notice = '';
            this.started = performance.now();
            this.raf = requestAnimationFrame(() => this.frame());
        }
        catch (error) {
            ui.notice = `Could not start the simulation: ${(error as Error).message}`;
            ui.running = false;
        }
    }

    /** Where the animation puts every vertex of every mesh in the world now, in blocks */
    private captureCloth(): Map<string, V3[]> {
        const out = new Map<string, V3[]>();
        const THREE = G.THREE;
        const wanted = new Set(this.rig?.clothKeys() ?? []);

        if (wanted.size === 0) return out;

        for (const { element } of meshElements()) {
            const key = String(element.uuid);
            const object = element.mesh;

            if (!wanted.has(key) || !object) continue;

            object.updateMatrixWorld(true);
            out.set(key, Object.values(element.vertices ?? {}).map((v: any): V3 => {
                const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(object.matrixWorld);

                return [p.x / U, p.y / U, p.z / U];
            }));
        }

        for (const { element } of cubeElements()) {
            const key = String(element.uuid);
            const object = element.mesh;

            if (!wanted.has(key) || !object) continue;

            object.updateMatrixWorld(true);
            out.set(key, cubeLocal(element).map((v): V3 => {
                const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(object.matrixWorld);

                return [p.x / U, p.y / U, p.z / U];
            }));
        }

        return out;
    }

    private clothObjects = new Map<string, ClothDisplay>();
    private hiddenMeshes: any[] = [];

    /**
     * The mesh that draws one simulated element with the model's own texture: a mesh element keeps its own geometry (its texture coordinates, triangles and
     * material groups) and only its points move; a cube is drawn as the grid the simulation moves, its texture coordinates taken from the cube's own faces
     */
    private makeDisplay(input: ClothMeshInput, element: any): ClothDisplay {
        const THREE = G.THREE;
        const original = element?.mesh;
        const place = groupsByPlace(input.rest);
        let geometry: any = null;
        let material: any = null;
        let slots: number[] | null = null;
        let groupOf: number[] = place;

        if (element instanceof G.Mesh && original?.geometry?.attributes?.position) {
            const list = input.faces.flat();

            // one point for each corner of each face, in the order the faces are: the order of the scene's own geometry
            if (original.geometry.attributes.position.count === list.length) {
                geometry = original.geometry.clone();
                material = original.material;
                slots = list;
                groupOf = list.map(v => place[v]);
            }
        }
        else if (element instanceof G.Cube && original?.geometry?.attributes?.position && original.geometry.attributes.uv) {
            const o = (element.origin ?? [0, 0, 0]) as V3;
            const grid = cubeGrid((element.from as V3).map((v, a) => v - o[a]) as V3, (element.to as V3).map((v, a) => v - o[a]) as V3);

            if (grid) {
                const textured = CUBE_FACES.filter(f => element.faces?.[f]?.texture !== null);
                const display = cubeDisplay(grid, original.geometry.attributes.position.array, original.geometry.attributes.uv.array, face => textured.includes(CUBE_FACES[face]));
                const many = Array.isArray(original.material);

                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grid.local.length * 3), 3));
                geometry.setAttribute('uv', new THREE.BufferAttribute(display.uv, 2));
                geometry.setIndex(display.index);

                for (const g of display.groups) {
                    const j = textured.indexOf(CUBE_FACES[g.face]);

                    geometry.addGroup(g.start, g.count, many ? Math.max(0, Math.min(original.material.length - 1, j)) : 0);
                }

                material = original.material;
            }
        }

        let own = false;

        if (!geometry || !material) {
            // no texture to borrow: the welded surface in one plain colour
            const index: number[] = [];

            for (const face of input.faces) for (let k = 1; k + 1 < face.length; k++) index.push(face[0], face[k], face[k + 1]);

            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(input.rest.length * 3), 3));
            geometry.setIndex(index);
            material = new THREE.MeshLambertMaterial({ color: 0xe9b7a5, side: THREE.DoubleSide });
            slots = null;
            groupOf = place;
            own = true;
        }

        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));

        const mesh = new THREE.Mesh(geometry, material);

        mesh.frustumCulled = false;

        return { mesh, slots, groupOf, own };
    }

    /** Draws the simulated cloth and flesh as meshes in the scene, in place of the originals (which are hidden while the simulation runs) */
    private drawCloth(): void {
        if (!this.rig || !G.THREE || !G.Canvas?.scene) return;

        const inputs = new Map(meshInputs().map(m => [m.key, m]));
        const elements = new Map([...meshElements(), ...cubeElements()].map(m => [String(m.element.uuid), m.element]));

        for (const key of this.rig.clothKeys()) {
            const verts = this.rig.clothVertices(key);
            const input = inputs.get(key);

            if (!verts || !input) continue;

            let display = this.clothObjects.get(key);

            if (!display) {
                display = this.makeDisplay(input, elements.get(key));
                G.Canvas.scene.add(display.mesh);
                this.clothObjects.set(key, display);

                const original = elements.get(key)?.mesh;

                if (original && original.visible !== false) {
                    original.visible = false;
                    this.hiddenMeshes.push(original);
                }
            }

            const geometry = display.mesh.geometry;
            const position = geometry.getAttribute('position');
            const array = position.array as Float32Array;
            const slots = display.slots;

            for (let i = 0; i < position.count; i++) {
                const v = verts[slots ? slots[i] : i];

                if (!v) continue;

                array[i * 3] = v[0] * U;
                array[i * 3 + 1] = v[1] * U;
                array[i * 3 + 2] = v[2] * U;
            }

            position.needsUpdate = true;

            const normal = geometry.getAttribute('normal');

            normal.array.set(smoothNormals(array, geometry.index?.array ?? [], display.groupOf));
            normal.needsUpdate = true;
            geometry.computeBoundingSphere();
        }
    }

    private removeCloth(): void {
        for (const display of this.clothObjects.values()) {
            display.mesh.parent?.remove(display.mesh);
            display.mesh.geometry?.dispose();

            // the model's own materials are not ours to dispose
            if (display.own) display.mesh.material?.dispose();
        }

        this.clothObjects.clear();

        for (const original of this.hiddenMeshes) original.visible = true;

        this.hiddenMeshes = [];
    }

    // ---- the camera follows the model ----

    /** What the camera has been moved by while it follows: a turn about the vertical axis and a move, which are undone when the simulation stops */
    private camLock: { preview: any; theta: number; shift: V3; prev: V3 | null; prevYaw: number } | null = null;

    setCamMode(mode: 'off' | 'model' | 'bone'): void {
        ui.camMode = mode;

        // the point it follows is a different one now: the next step starts from it, with no jump
        if (this.camLock) this.camLock.prev = null;
    }

    /** A turn about the vertical axis, the way the scene turns its models */
    private static turnY(v: V3, angle: number): V3 {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    }

    /**
     * Moves the camera and what it looks at the way the followed point moved and turned this step, so the model stays where it is on screen: only the axes and the
     * turning that are switched on. {@code anchor} is where the model (or the picked bone) is, in the scene, {@code yaw} how far the move has turned it
     */
    private followCamera(anchor: V3, yaw: number): void {
        const preview = G.Preview?.selected;

        if (!preview?.camera || !preview.controls?.target) return;

        if (!this.camLock || this.camLock.preview !== preview) this.camLock = { preview, theta: 0, shift: [0, 0, 0], prev: null, prevYaw: yaw };

        const lock = this.camLock;
        const before = lock.prev;
        const beforeYaw = lock.prevYaw;

        lock.prev = anchor;
        lock.prevYaw = yaw;

        if (!before) return;

        const d = ui.camTurn ? yaw - beforeYaw : 0;
        const move: V3 = [ui.camX ? anchor[0] - before[0] : 0, ui.camY ? anchor[1] - before[1] : 0, ui.camZ ? anchor[2] - before[2] : 0];

        if (d === 0 && move[0] === 0 && move[1] === 0 && move[2] === 0) return;

        const apply = (p: any): void => {
            const turned = Session.turnY([p.x - before[0], p.y - before[1], p.z - before[2]], d);

            p.set(before[0] + turned[0] + move[0], before[1] + turned[1] + move[1], before[2] + turned[2] + move[2]);
        };

        apply(preview.camera.position);
        apply(preview.controls.target);

        // what has been done, as one turn and one move, to be undone
        const rotated = Session.turnY(lock.shift, d);
        const own = Session.turnY(before, d);

        lock.theta += d;
        lock.shift = [rotated[0] + before[0] - own[0] + move[0], rotated[1] + before[1] - own[1] + move[1], rotated[2] + before[2] - own[2] + move[2]];
        preview.controls.update?.();
    }

    /** Puts the camera back where the model is again, after the simulation: the turn and the move it was given are taken off */
    private releaseCamera(): void {
        const lock = this.camLock;

        this.camLock = null;

        if (!lock || !lock.preview?.camera || !lock.preview.controls?.target) return;

        const undo = (p: any): void => {
            const back = Session.turnY([p.x - lock.shift[0], p.y - lock.shift[1], p.z - lock.shift[2]], -lock.theta);

            p.set(back[0], back[1], back[2]);
        };

        undo(lock.preview.camera.position);
        undo(lock.preview.controls.target);
        lock.preview.controls.update?.();
    }

    stop(): void {
        if (!ui.running && !this.raf) return;

        cancelAnimationFrame(this.raf);
        this.raf = 0;
        ui.running = false;
        this.releaseCamera();

        try {
            const model = G.Project?.model_3d;

            if (model && this.modelSnapshot) {
                model.position.copy(this.modelSnapshot.p);
                model.rotation.y = this.modelSnapshot.ry;
            }

            this.removeCloth();
            this.restore();
            G.Canvas.updateAllBones?.();

            if (ui.animation) G.Animator?.showDefaultPose?.();

            this.simTime = 0;
            this.placePropMeshes(0);

            if (this.rig) this.rig.props = ui.props.map(p => this.propShape(p, 0));
        }
        catch { /* leaving the tab mid-load */ }

        this.drawOverlay();
    }

    resetSim(): void {
        this.rig?.reset();
        this.started = performance.now();
    }

    private frame(): void {
        if (!ui.running || !this.rig) return;

        try {
            const t = (performance.now() - this.started) / 1000 * ui.speed;
            const m = motionAt(ui.motion, t, ui.motionOpts[ui.motion]);
            const model = G.Project?.model_3d;

            if (model) {
                model.position.set(this.modelSnapshot!.p.x + m.pos[0] * U, this.modelSnapshot!.p.y + m.pos[1] * U, this.modelSnapshot!.p.z + m.pos[2] * U);
                model.rotation.y = this.modelSnapshot!.ry + m.yaw;
            }

            // bones back to the rest pose, then the chosen animation over it, then the physics over that
            this.restore();

            const animation = ui.animation ? ((G.Animation?.all ?? []) as any[]).find(a => a.name === ui.animation) : null;

            if (animation) {
                if (G.Animation.selected !== animation) animation.select?.();

                G.Timeline?.setTime?.(t % Math.max(0.05, animation.length || 1));
                G.Animator?.preview?.();
            }

            model?.updateMatrixWorld(true);

            this.simTime = t;
            this.placePropMeshes(t);
            this.rig.props = ui.props.map(p => this.propShape(p, t));
            this.keepGizmo();

            const frames = this.captureFrames();
            const root: Q4 = qaxisY(m.yaw);

            if (ui.camMode !== 'off') {
                const bone = ui.camMode === 'bone' && ui.selected ? frames.get(ui.selected) : undefined;
                const at: V3 | null = bone ? [bone.origin[0] * U, bone.origin[1] * U, bone.origin[2] * U] : model ? [model.position.x, model.position.y, model.position.z] : null;

                if (at) this.followCamera(at, m.yaw);
            }

            this.rig.clothAnimated = this.captureCloth();

            const results = this.rig.update(frames, { pos: m.pos, yaw: m.yaw }, root, t);

            for (const g of groups()) {
                const r = results.get(g.name);

                if (!r || !g.mesh) continue;

                g.mesh.quaternion.set(r.local[0], r.local[1], r.local[2], r.local[3]);

                const snap = this.snapshots.get(g.name);
                const base = snap ? snap.s : g.mesh.scale;

                g.mesh.scale.set(base.x * r.scale[0], base.y * r.scale[1], base.z * r.scale[2]);
            }

            model?.updateMatrixWorld(true);
            this.drawCloth();
            this.drawOverlay();
        }
        catch (error) {
            ui.notice = `The simulation stopped: ${(error as Error).message}`;
            this.stop();

            return;
        }

        this.raf = requestAnimationFrame(() => this.frame());
    }

    dispose(): void {
        this.stop();
        this.removeCloth();
        this.removeOverlay();
        this.clearPropMeshes();
    }
}

const session = new Session();

// ---------------- the mode and the panel ----------------

let mode: any = null;
let panels: any[] = [];
let css: any = null;
let onSelection: (() => void) | null = null;
let onProject: (() => void) | null = null;
let onKey: ((event: KeyboardEvent) => void) | null = null;
let onPointerDown: ((event: PointerEvent) => void) | null = null;
let onPointerUp: ((event: PointerEvent) => void) | null = null;
let onPointerMove: (() => void) | null = null;
let propModule: any = null;

export function loadPhysicsTab(): void {
    if (!G.Mode || !G.Panel) return;

    css = G.Blockbench.addCSS(CSS);

    // each window is a panel of its own, all showing the same state
    panels = WINDOWS.map(w => new G.Panel(w.panel, {
        name: w.name,
        icon: w.icon,
        growable: true,
        resizable: true,
        condition: { modes: [MODE_ID] },
        default_position: { float_position: [0, 0], float_size: [340, w.position.height], ...w.position },
        component: windowComponent(w.id, ui, session),
    }));

    mode = new G.Mode(MODE_ID, {
        name: 'Physics',
        icon: 'waves',
        default_tool: 'move_tool',
        selectElements: false,
        category: 'navigate',
        hidden_node_types: ['cube', 'mesh', 'locator', 'null_object', 'texture_mesh', 'spline'],
        condition: () => G.Format?.id === 'strut_model' || G.Format?.id === 'animated_entity_model',
        onSelect() {
            session.reload();
        },
        onUnselect() {
            session.dispose();
        },
    });

    try {
        G.Modes?.vue?.$forceUpdate?.();
    }
    catch { /* the mode list re-renders on its own */ }

    onSelection = () => {
        if (G.Mode?.selected?.id !== MODE_ID) return;

        if (!session.keepBonesSelected()) session.queueRefresh();
    };
    onProject = () => {
        session.stop();
        session.clearHistory();

        if (G.Mode?.selected?.id === MODE_ID) session.reload();
    };
    onKey = (event: KeyboardEvent) => {
        if (G.Mode?.selected?.id === MODE_ID && event.key === 'Escape' && ui.picking) {
            session.stopPicking();

            return;
        }

        if (G.Mode?.selected?.id !== MODE_ID || !(event.ctrlKey || event.metaKey)) return;

        const target = event.target as HTMLElement | null;

        // typing in a text box keeps its own undo
        if (target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && ['text', 'number'].includes((target as HTMLInputElement).type)))) return;

        const key = event.key.toLowerCase();
        const redo = key === 'y' || (key === 'z' && event.shiftKey);
        const undo = key === 'z' && !event.shiftKey;

        if ((undo && ui.canUndo) || (redo && ui.canRedo)) {
            event.preventDefault();
            event.stopPropagation();

            if (undo) session.undo();
            else session.redo();
        }
    };
    document.addEventListener('keydown', onKey, true);

    // a click in the view picks a bone (the bone of the cube or mesh under it) or a test shape; a drag is the camera, and the gizmo keeps its own clicks
    let down: { x: number; y: number; preview: any } | null = null;

    onPointerDown = (event: PointerEvent) => {
        const preview = G.Mode?.selected?.id === MODE_ID && event.button === 0 ? ((G.Preview?.all ?? []) as any[]).find(p => p.canvas === event.target) : null;

        down = preview ? { x: event.clientX, y: event.clientY, preview } : null;
    };
    onPointerUp = (event: PointerEvent) => {
        const start = down;

        down = null;

        if (!start || G.Mode?.selected?.id !== MODE_ID || event.button !== 0) return;

        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4 || G.Transformer?.dragging || G.Transformer?.hoverAxis || G.Transformer?.axis) return;

        session.pickInView(start.preview, event);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);

    // the gizmo for a picked test shape: move, rotate and scale tools act on it
    onPointerMove = () => session.keepGizmo();
    document.addEventListener('pointermove', onPointerMove, true);

    if (G.TransformerModule) {
        const tools = ['move_tool', 'rotate_tool', 'resize_tool'];
        const tool = (): string => G.Toolbox?.selected?.id ?? '';

        propModule = new G.TransformerModule('strut_physics_props', {
            priority: 5,
            condition: () => G.Mode?.selected?.id === MODE_ID && ui.selectedProp !== null,
            use_condition: () => tools.includes(tool()),
            updateGizmo() {
                const at = session.propPosition();

                if (!at || !tools.includes(tool())) return false;

                G.Transformer.position.copy(at);

                if (tool() === 'move_tool') delete G.Transformer.rotation_ref;
                else G.Transformer.rotation_ref = session.propObject();

                return true;
            },
            calculateOffset(context: any) {
                const e = context.event ?? {};
                const grid = typeof G.canvasGridSize === 'function' ? G.canvasGridSize(!!e.shiftKey, !!(e.ctrlKey || e.metaKey)) : 0.25;

                if (tool() === 'rotate_tool') {
                    const interval = typeof G.getRotationInterval === 'function' ? G.getRotationInterval(e) : 1;
                    const trim = (Math as any).trimDeg;

                    return Math.round((trim ? trim(context.angle) : context.angle) / interval) * interval;
                }

                if (tool() === 'resize_tool') {
                    const raw = context.axis === 'e' ? context.point.length() * Math.sign(context.point.y || context.point.x) : context.point[context.axis];
                    const step = grid * 0.1;

                    return Math.round(raw * context.direction * 0.1 / step) * step;
                }

                if (!['x', 'y', 'z'].includes(context.axis)) return 0;

                return Math.round(context.point[context.axis] / grid) * grid;
            },
            onStart() {
                session.beginDrag();
            },
            onMove(this: any, context: any) {
                session.dragProp(tool(), context.axis, context.value - (this.previous_value || 0));
            },
            onEnd() {
                session.endDrag();
            },
            onCancel() {
                session.endDrag();
            },
        });
    }

    G.Blockbench.on('update_selection', onSelection);
    G.Blockbench.on('select_project', onProject);
}

export function unloadPhysicsTab(): void {
    if (onSelection) G.Blockbench.removeListener?.('update_selection', onSelection);
    if (onProject) G.Blockbench.removeListener?.('select_project', onProject);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onPointerDown) document.removeEventListener('pointerdown', onPointerDown, true);
    if (onPointerUp) document.removeEventListener('pointerup', onPointerUp, true);
    if (onPointerMove) document.removeEventListener('pointermove', onPointerMove, true);

    onPointerMove = null;

    propModule?.delete?.();
    propModule = null;
    onPointerDown = null;
    onPointerUp = null;

    onSelection = null;
    onProject = null;
    onKey = null;
    session.dispose();
    mode?.delete?.();
    for (const p of panels) p?.delete?.();
    css?.delete?.();
    mode = null;
    panels = [];
    css = null;
}
