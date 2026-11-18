/**
 * What the windows of the Physics tab are made of: the small components (a section, a slider, a tick box, joined buttons, a list of bones), the values every window
 * can compute from the state, and the methods that pass what the user does to the session. Each window is one component built from these around its own template.
 * The state ({@code ui}) is shared, so all of the windows show the same thing
 */
import {
    BONES_TEMPLATE, CHAIN_GROUPS, CLOTH_GROUPS, FLESH_GROUPS, Group, JSON_TEMPLATE, KIND_HELP, KIND_ICONS, KIND_OPTIONS, OBJECTS_TEMPLATE, PROPERTIES_TEMPLATE, SHAPES_TEMPLATE,
    SIMULATE_TEMPLATE, SPRING_GROUPS,
} from './physicsPanels';
import { defaultMotionOptions, MOTION_DEFS } from './physics/motion';
import { CHAIN_DEFAULTS, fleshControls, SPRING_DEFAULTS, softControls } from './physics/edit';
import type { PartKind } from './physics/edit';

const TEMPLATES = { simulate: SIMULATE_TEMPLATE, bones: BONES_TEMPLATE, properties: PROPERTIES_TEMPLATE, shapes: SHAPES_TEMPLATE, objects: OBJECTS_TEMPLATE, json: JSON_TEMPLATE };

export type WindowId = keyof typeof TEMPLATES;

const COMPONENTS: Record<string, any> = {
    /** A collapsible section: a header that folds its body, with a line saying what it is for */
    'phys-sec': {
        props: ['title', 'open', 'badge', 'icon', 'desc', 'sub'],
        template: `<div class="ph-sec" :class="{ sub: sub !== undefined && sub !== false }">
            <div class="ph-sec-head" @click="$emit('toggle')"><i class="material-icons">{{ open ? 'expand_more' : 'chevron_right' }}</i><i class="material-icons" v-if="icon">{{ icon }}</i>
              <span class="ph-sec-title">{{ title }}</span><span class="ph-sec-badge" v-if="badge">{{ badge }}</span></div>
            <div class="ph-sec-desc" v-if="open && desc">{{ desc }}</div>
            <div class="ph-sec-body" v-if="open"><slot></slot></div></div>`,
    },
    /** A number with a slider and a box to type it in; its description under it when the descriptions are on */
    'phys-slider': {
        props: ['label', 'hint', 'help', 'min', 'max', 'step', 'value', 'unit', 'base'],
        computed: {
            /** Whether it is not at its default */
            changed(): boolean {
                const base = (this as any).base;

                return base !== undefined && base !== null && Math.abs(Number((this as any).value) - Number(base)) > (Number((this as any).step) || 0.01) / 2;
            },
        },
        methods: {
            shown(of?: number): string {
                const v = Number(of !== undefined ? of : (this as any).value);
                const step = Number((this as any).step) || 0.01;
                const places = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));

                return Number.isFinite(v) ? v.toFixed(places) : '';
            },
        },
        template: `<div class="ph-slider" :title="hint">
            <div class="ph-slider-top"><label>{{ label }}</label><input type="number" :step="step" :value="shown()" @change="$emit('input', Number($event.target.value))"><span class="ph-unit" v-if="unit">{{ unit }}</span>
              <button class="ph-reset" :class="{ off: !changed }" :disabled="!changed" @click="$emit('input', base)" :title="changed ? 'Put it back to its default (' + shown(base) + ')' : 'It is at its default'"><i class="material-icons">undo</i></button></div>
            <input type="range" :min="min" :max="max" :step="step" :value="value" @input="$emit('input', Number($event.target.value))">
            <div class="ph-help" v-if="help && hint">{{ hint }}</div></div>`,
    },
    /** A tick box with its label, and what it does under it */
    'phys-check': {
        props: ['label', 'hint', 'help', 'value'],
        template: `<label class="ph-check" :title="hint"><span class="ph-check-row"><input type="checkbox" :checked="value" @change="$emit('input', $event.target.checked)"><span>{{ label }}</span></span>
            <div class="ph-help" v-if="help && hint">{{ hint }}</div></label>`,
    },
    /** One choice of a few, as joined buttons */
    'phys-seg': {
        props: ['options', 'value'],
        template: `<div class="ph-seg"><button v-for="o in options" :key="o.id" :class="{ on: o.id === value }" :disabled="o.disabled" :title="o.title" @click="$emit('input', o.id)">
            <i class="material-icons" v-if="o.icon">{{ o.icon }}</i>{{ o.label }}</button></div>`,
    },
    /** A list of bones as chips that can be taken off, and the one way bones are chosen everywhere: the button picks them in the view or in the Bones window, where the ones that cannot be picked are greyed out */
    'phys-bones': {
        props: ['items', 'active', 'all', 'limit'],
        computed: {
            shown(): string[] {
                return ((this as any).items as string[]).slice(0, (this as any).limit || 12);
            },
            more(): number {
                return Math.max(0, ((this as any).items as string[]).length - ((this as any).limit || 12));
            },
        },
        template: `<div class="ph-bones-list">
            <div class="ph-chips"><span class="ph-all" v-if="all">{{ all }}</span>
              <template v-else><span class="ph-pick" v-for="b in shown" :key="b">{{ b }}<i class="material-icons" @click.stop="$emit('remove', b)" title="Take it off">close</i></span>
              <span class="ph-hint" v-if="more">and {{ more }} more</span>
              <span class="ph-hint" v-if="!items.length"><slot></slot></span></template></div>
            <div class="ph-tools"><button class="ph-chip" :class="{ on: active }" @click="$emit('pick')" title="Click bones in the view or in the Bones window; the ones that cannot be picked here are greyed out"><i class="material-icons">touch_app</i>{{ active ? 'Done' : 'Pick bones' }}</button>
              <slot name="tools"></slot></div></div>`,
    },
};

/** One window's component: its template, the shared state, and what it can compute and do */
export function windowComponent(id: WindowId, ui: any, session: any, openPhysicsJson?: () => void): any {
    return {
        template: TEMPLATES[id],
        data() {
            return { ui };
        },
        computed: {
            kindOptions() {
                return KIND_OPTIONS.map(o => ({
                    ...o,
                    disabled: (o.id === 'cloth' && !ui.hasMesh && ui.kind !== 'cloth') || (o.id === 'flesh' && !ui.hasShape && ui.kind !== 'flesh'),
                    title: o.id === 'cloth' && !ui.hasMesh && ui.kind !== 'cloth' ? 'This bone has no mesh. Cloth is made from the vertices of a mesh, not from cubes.'
                        : o.id === 'flesh' && !ui.hasShape && ui.kind !== 'flesh' ? 'This bone has no mesh or cube, and none of the bones under it have, to make flesh from.' : o.title,
                }));
            },
            kindHelp(): string {
                return KIND_HELP[ui.kind as PartKind];
            },
            /** The ready-made looks of the picked kind */
            looks(): { id: string; label: string }[] {
                if (ui.kind === 'flesh') return ui.fleshLooks;

                if (ui.kind === 'cloth') return ui.softLooks.filter((l: any) => l.kind === 'cloth');

                return ui.looks.filter((l: any) => l.kind === ui.kind);
            },
            groups(): Group[] {
                const all = ui.kind === 'spring' ? SPRING_GROUPS : ui.kind === 'chain' ? CHAIN_GROUPS : ui.kind === 'cloth' ? CLOTH_GROUPS : ui.kind === 'flesh' ? FLESH_GROUPS : [];

                return all.filter(g => g.when !== 'pair' || ui.flesh.bones.length > 1);
            },
            earlyGroups(): Group[] {
                return (this as any).groups.filter((g: Group) => !g.late);
            },
            lateGroups(): Group[] {
                return (this as any).groups.filter((g: Group) => g.late);
            },
            /** The controls of the picked part, whatever its kind */
            model(): any {
                return ui.kind === 'flesh' ? ui.flesh : ui.kind === 'cloth' ? ui.soft : ui.controls;
            },
            /** The other bone of the picked flesh's pair, or none */
            partner(): string {
                return ui.flesh.bones.find((b: string) => b !== ui.selected) ?? '';
            },
            /** The three collision ticks, as a label and what it means */
            /** The default of every number of the picked part: those of its look, the ones to put a slider back to */
            defaults(): any {
                if (ui.kind === 'flesh') return fleshControls({ flesh: { x: { bone: 'x', preset: ui.flesh.preset } } }, 'x');

                if (ui.kind === 'cloth') return softControls({}, '', 'cloth');

                return ui.kind === 'chain' ? CHAIN_DEFAULTS : SPRING_DEFAULTS;
            },
            /** The bones it reacts to, as the list shows them: a line when it is all of them */
            collideAll(): string {
                const n = ui.candidates.length;

                return n > 0 && ui.candidates.every((b: string) => session.isTicked(b)) ? `Every bone with a shape (${n})` : '';
            },
            collideItems(): string[] {
                return ui.candidates.filter((b: string) => session.isTicked(b));
            },
            collideLabels(): string[][] {
                if (ui.kind === 'flesh') {
                    return [
                        ['Rests on its own body', 'The rest of the model is solid for it, except the bones named in Pressed by.'],
                        ['Is pressed by the floor and test objects', 'They push the flesh in; what they press out of shows as it swelling elsewhere.'],
                        ['Is pressed by other models and players', 'Only in the game: not drawn here.'],
                    ];
                }

                return [
                    ['Bumps into its own body', 'It cannot pass through the shapes of the rest of the model.'],
                    ['Bumps into the floor and test objects', 'Blocks in the game, and the floor and the test objects here.'],
                    ['Bumps into other models and players', 'Only in the game: not drawn here.'],
                ];
            },
            pivotHelp(): string {
                return ui.flesh.pivotMode === 'bone' ? "The swing turns about the bone's own pivot, where you put the joint."
                    : ui.flesh.pivotMode === 'auto' ? 'The swing turns about the base of the fitted cage.' : "The swing turns about this point, in the bone's space, in blocks.";
            },
            nestedOptions() { return [{ id: 'rigid', label: 'Ride on it' }, { id: 'soft', label: 'Are soft too' }]; },
            pivotOptions() { return [{ id: 'bone', label: 'The bone' }, { id: 'auto', label: 'Auto' }, { id: 'custom', label: 'A point' }]; },
            autoOptions() {
                return [{ id: 'auto', label: 'Auto', title: 'By the rules: a box per cube for a few cubes, one simple shape for many' }, { id: 'exact', label: 'Exact', title: 'A box around every cube' },
                    { id: 'simple', label: 'Simple', title: 'One capsule or box around the whole bone' }, { id: 'off', label: 'None', title: 'No shape for this bone' }];
            },
            axisOptions() { return [{ id: 'x', label: 'X', title: 'Left and right' }, { id: 'y', label: 'Y', title: 'Up and down' }, { id: 'z', label: 'Z', title: 'Forward and back' }]; },
            shapeOptions() { return [{ id: 'sphere', label: 'Sphere' }, { id: 'capsule', label: 'Capsule' }, { id: 'box', label: 'Box' }]; },
            camOptions() {
                return [{ id: 'off', label: 'Free', icon: 'videocam_off', title: 'The camera stays where you put it' }, { id: 'model', label: 'Model', icon: 'person', title: 'Hold the camera on the model' },
                    { id: 'bone', label: 'Bone', icon: 'adjust', title: 'Hold the camera on the picked bone' }];
            },
            motionDef(): any {
                return MOTION_DEFS.find(d => d.id === ui.motion) ?? MOTION_DEFS[0];
            },
            axes() { return ['auto', '+x', '-x', '+y', '-y', '+z', '-z']; },
            /** The test object picked, or null */
            object(): any {
                return ui.props.find((p: any) => p.id === ui.selectedProp) ?? null;
            },
            /** The bones shown: all whose parents are open, or every match while searching or listing only the bones with physics */
            visibleTree(): any[] {
                const q = ui.query.trim().toLowerCase();

                if (q || ui.onlyPhysics) return ui.tree.filter((n: any) => (!q || n.name.toLowerCase().includes(q)) && (!ui.onlyPhysics || n.kind !== 'none'));

                const byName = new Map(ui.tree.map((n: any) => [n.name, n]));

                return ui.tree.filter((n: any) => {
                    for (let p = n.parent; p; p = (byName.get(p) as any)?.parent ?? null) if (!ui.open[p]) return false;

                    return true;
                });
            },
        },
        methods: {
            camMode(mode: string) { session.setCamMode(mode); },
            setMotion(id: string, value: number) { (this as any).$set(ui.motionOpts[ui.motion], id, value); },
            resetMotion() { ui.motionOpts = { ...ui.motionOpts, [ui.motion]: defaultMotionOptions()[ui.motion] }; },
            toggle() { if (ui.running) session.stop(); else session.start(); },
            reset() { session.resetSim(); },
            poke() { session.poke(); },
            undo() { session.undo(); },
            redo() { session.redo(); },
            groupOpen(g: { id: string; open?: boolean }) { return ui.groups[`${ui.kind}:${g.id}`] ?? !!g.open; },
            toggleGroup(g: { id: string; open?: boolean }) { (this as any).$set(ui.groups, `${ui.kind}:${g.id}`, !(this as any).groupOpen(g)); },
            kindIcon(kind: string) { return KIND_ICONS[kind] ?? ''; },
            // bones
            pick(name: string, event: MouseEvent) {
                if (ui.picking) session.pickRow(name);
                else session.pick(name, event);
            },
            // the state of a row of the Bones window while bones are picked for a list
            offRow(name: string) { return !!ui.picking && !ui.picking.valid.includes(name); },
            offReason(name: string) { return ui.picking && !ui.picking.valid.includes(name) ? `${name} ${session.whyNot(ui.picking.kind, name)}` : ''; },
            listedRow(name: string) { return !!ui.picking && session.pickedList().includes(name); },
            togglePicking(kind: string) {
                if (ui.picking && ui.picking.kind === kind) session.stopPicking();
                else session.startPicking(kind);
            },
            untick(bone: string) { session.tick(bone, false); },
            fold(n: any) { ui.open = { ...ui.open, [n.name]: !ui.open[n.name] }; },
            expandAll(open: boolean) { session.expandAll(open); },
            pickPhysics() { session.pickPhysics(); },
            pickNone() { session.pickNone(); },
            // properties
            kind(k: PartKind) { session.setKind(k); },
            look(id: string) { session.applyAnyLook(id); },
            lookOn(id: string) { return ui.kind === 'flesh' && ui.flesh.preset === id; },
            setField(key: string, value: number | boolean) { session.setField(key, value); },
            centre(axis: number, value: number) { session.setCentre(axis, value); },
            zone() { session.zoneFromMesh(); },
            carryOn(bone: string, on: boolean) { session.toggleCarry(bone, on); },
            pairWith(bone: string) { session.setFleshPartner(bone); },
            nestedChoice(id: string) { session.setFleshPatch({ nestedSoft: id === 'soft' }); },
            pivotChoice(id: string) { session.setFleshPatch({ pivotMode: id }); },
            pivotAt(axis: number, value: number) {
                const pivot = [...ui.flesh.pivot];

                pivot[axis] = value;
                session.setFleshPatch({ pivot });
            },
            axisChoice(which: 'tip' | 'up', value: string) { session.setFleshPatch({ [which]: value }); },
            pressesChoice(text: string) { session.setFleshPatch({ presses: text.split(/[\s,]+/).filter(s => s.length > 0) }); },
            startPicking(kind: string) { session.startPicking(kind); },
            stopPicking() { session.stopPicking(); },
            setCollide(how: 'all' | 'none' | 'invert') { session.setCollide(how); },
            isTicked(bone: string) { return session.isTicked(bone); },
            tick(bone: string, event: Event) { session.tick(bone, (event.target as HTMLInputElement).checked); },
            limitOn(axis: 'x' | 'y' | 'z', on: boolean) { session.toggleLimit(axis, on); },
            setLimit(axis: 'x' | 'y' | 'z', end: 0 | 1, value: number) { session.setLimit(axis, end, value); },
            redraw() { session.drawOverlay(); },
            // shapes
            auto(value: boolean) { session.setAuto(value ? null : false); },
            setMode(m: string) { session.setMode(m); },
            shape(s: string) { session.addShape(s); },
            selectShape(index: number) { session.selectShape(index); },
            shapeKind(k: string) { session.setShapeKind(k); },
            val(key: string, axis: number, value: number) { session.setShapeValue(key, axis, value); },
            fitShape() { session.fitShape(); },
            duplicateShape() { session.duplicateShape(); },
            deleteShape() { session.deleteShape(); },
            // test objects
            prop(kind: string) { session.addProp(kind); },
            propsChanged() { session.syncProps(); session.keepGizmo(); },
            refreshProps() { session.refreshProps(); },
            dupProp(id: number) { session.duplicateProp(id); },
            dropProp(id: number) { session.removeProp(id); },
            clearProps() { session.clearProps(); },
            selectProp(id: number) { session.selectProp(ui.selectedProp === id ? null : id); },
            propName(p: any) {
                const label = p.kind === 'sphere' ? 'Ball' : p.kind === 'box' ? 'Block' : p.kind === 'capsule' ? 'Pole' : 'Wall';
                const same = ui.props.filter((x: any) => x.kind === p.kind);

                return same.length > 1 ? `${label} ${same.indexOf(p) + 1}` : label;
            },
            propIcon(p: any) { return p.kind === 'sphere' ? 'circle' : p.kind === 'box' ? 'crop_square' : p.kind === 'capsule' ? 'straighten' : 'view_column'; },
            // json
            jsonInput(text: string) { session.editJson(text); },
            jsonFocus(on: boolean) { session.jsonFocus(on); },
            jsonFormat() { session.formatJson(); },
            jsonRevert() { session.revertJson(); },
            jsonFill() { session.fillJson(); },
            jsonTab(event: KeyboardEvent) {
                const area = event.target as HTMLTextAreaElement;
                const from = area.selectionStart;

                area.setRangeText('  ', from, area.selectionEnd, 'end');
                session.editJson(area.value);
            },
            openJson() { openPhysicsJson?.(); },
        },
        components: COMPONENTS,
    };
}

/** The windows, with where each docks until the user moves it */
export const WINDOWS: { id: WindowId; panel: string; name: string; icon: string; position: Record<string, any> }[] = [
    { id: 'simulate', panel: 'strut_physics_panel', name: 'Physics', icon: 'play_circle', position: { slot: 'right_bar', height: 330 } },
    { id: 'bones', panel: 'strut_physics_bones', name: 'Physics: Bones', icon: 'account_tree', position: { slot: 'left_bar', height: 420 } },
    { id: 'properties', panel: 'strut_physics_properties', name: 'Physics: Properties', icon: 'tune', position: { slot: 'right_bar', height: 620 } },
    { id: 'shapes', panel: 'strut_physics_shapes', name: 'Physics: Shapes', icon: 'category', position: { slot: 'right_bar', height: 360, folded: true } },
    { id: 'objects', panel: 'strut_physics_objects', name: 'Physics: Test Objects', icon: 'sports_baseball', position: { slot: 'left_bar', height: 360 } },
    { id: 'json', panel: 'strut_physics_json', name: 'Physics: JSON', icon: 'code', position: { slot: 'bottom', height: 240 } },
];
