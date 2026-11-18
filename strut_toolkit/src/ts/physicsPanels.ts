/**
 * The windows of the Physics tab, in the way an editor lays them out: Simulate (run it, test motion), Bones (the hierarchy), Properties (what the picked bones are
 * and how they feel), Shapes (collision shapes), Test Objects (things to bump into) and JSON (the text the game reads). Each is its own Blockbench panel, so each can
 * be docked, floated or tabbed where the user likes, and all of them show the same state ({@code ui}) and act through the same {@code session}. This file is
 * templates, styles and small components; what they do is in physicsTab.ts
 */
import type { PartKind } from './physics/edit';

/** One slider of the properties window: a number the part's controls hold, with its range and a description */
export interface Slider { key: string; label: string; min: number; max: number; step: number; hint: string; unit?: string }

/** A titled group of sliders; collapsed unless {@code open}. {@code when} limits it to parts it makes sense for, {@code late} puts it after the region blocks */
export interface Group { id: string; title: string; desc: string; icon: string; open?: boolean; sliders: Slider[]; when?: 'pair'; late?: boolean }

const FEEL_SPRING: Slider[] = [
    { key: 'stiffness', label: 'Stiffness', min: 0, max: 1, step: 0.01, hint: 'How hard it pulls back to where the animation puts it.' },
    { key: 'bounce', label: 'Bounciness', min: 0, max: 1, step: 0.01, hint: 'How long it keeps wobbling.' },
    { key: 'weight', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How much of the physics shows. 0 is the animation alone.' },
    { key: 'inertia', label: 'Lag', min: 0, max: 1, step: 0.01, hint: 'How much it trails behind when the model moves or turns.' },
];

export const SPRING_GROUPS: Group[] = [
    { id: 'feel', title: 'Feel', icon: 'tune', desc: 'How stiff, bouncy and laggy it is.', open: true, sliders: FEEL_SPRING },
    {
        id: 'detail', title: 'Detail', icon: 'straighten', desc: 'The size of the swinging mass and how gravity acts on it.', sliders: [
            { key: 'gravity', label: 'Gravity', min: 0, max: 15, step: 0.1, hint: '0 for jiggle, about 10 for hair.' },
            { key: 'length', label: 'Reach', min: 0.02, max: 1.2, step: 0.01, hint: 'Distance from the pivot to the swinging mass (blocks).' },
            { key: 'radius', label: 'Thickness', min: 0, max: 0.5, step: 0.01, hint: 'Its size when it bumps into things (blocks).' },
            { key: 'squish', label: 'Squish', min: 0, max: 1, step: 0.01, hint: 'How much it flattens when pressed.' },
        ],
    },
];

export const CHAIN_GROUPS: Group[] = [
    { id: 'feel', title: 'Feel', icon: 'tune', desc: 'How stiff, bouncy and laggy it is.', open: true, sliders: FEEL_SPRING },
    {
        id: 'detail', title: 'Detail', icon: 'straighten', desc: 'How far it reaches and how it hangs.', sliders: [
            { key: 'gravity', label: 'Gravity', min: 0, max: 15, step: 0.1, hint: '0 for jiggle, about 10 for hair.' },
            { key: 'length', label: 'Reach', min: 0.02, max: 1.2, step: 0.01, hint: 'How far the last bone reaches (blocks).' },
            { key: 'radius', label: 'Thickness', min: 0, max: 0.5, step: 0.01, hint: 'Its size when it bumps into things (blocks).' },
            { key: 'friction', label: 'Grip', min: 0, max: 1, step: 0.01, hint: 'How much it grips what it lies on.' },
        ],
    },
];

export const CLOTH_GROUPS: Group[] = [
    {
        id: 'feel', title: 'Feel', icon: 'tune', desc: 'How the cloth stretches, folds and is held.', open: true, sliders: [
            { key: 'stiffness', label: 'Stretch', min: 0, max: 1, step: 0.01, hint: 'How firmly each edge keeps its length. 1 does not stretch at all.' },
            { key: 'bend', label: 'Fold', min: 0, max: 1, step: 0.01, hint: 'How much a fold resists: 0 is silk, 1 is card.' },
            { key: 'anchor', label: 'Pull back', min: 0, max: 30, step: 0.5, hint: 'How firmly it is pulled back to the animated shape, per second. 0 lets cloth hang free.' },
            { key: 'weight', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How much of the physics shows. 0 is the mesh as modelled.' },
        ],
    },
    {
        id: 'detail', title: 'Detail', icon: 'straighten', desc: 'Where it is sewn on, how it settles and how thick it is.', sliders: [
            { key: 'pinHeight', label: 'Sewn on at top', min: 0, max: 1, step: 0.01, hint: 'The share of the mesh height, from the top, that is sewn to the bone.' },
            { key: 'damping', label: 'Settling', min: 0, max: 8, step: 0.1, hint: 'How quickly it stops moving.' },
            { key: 'inertia', label: 'Lag', min: 0, max: 1, step: 0.01, hint: 'How much it trails behind when the model moves or turns.' },
            { key: 'gravity', label: 'Gravity', min: 0, max: 15, step: 0.1, hint: '9.8 for cloth.' },
            { key: 'radius', label: 'Thickness', min: 0, max: 0.2, step: 0.005, hint: 'How thick it is when it bumps into things (blocks).' },
        ],
    },
];

export const FLESH_GROUPS: Group[] = [
    {
        id: 'feel', title: 'Feel', icon: 'tune', desc: 'How soft, firm and heavy it feels.', open: true, sliders: [
            { key: 'softness', label: 'Softness', min: 0.1, max: 3, step: 0.05, hint: '1 is the look. More is softer and slower, less is firmer.' },
            { key: 'firmness', label: 'Firmness', min: 0.2, max: 2, step: 0.05, hint: 'How fast it swings and settles: a scale on its frequency.' },
            { key: 'meat', label: 'Meat', min: 0, max: 2, step: 0.05, hint: 'How heavy and fleshy it feels: damped more, sagging more, a dent fading slowly. 0 is bouncy like a balloon.' },
            { key: 'weight', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How much of the physics shows. 0 is the mesh as modelled.' },
        ],
    },
    {
        id: 'swing', title: 'Swing', icon: 'swap_horiz', desc: 'How far it moves and how it settles after the body moves.', open: true, sliders: [
            { key: 'limit', label: 'Reach', min: 0, max: 0.4, step: 0.005, hint: 'The farthest the flesh moves from where the animation puts it, in blocks.' },
            { key: 'inertia', label: 'Lag', min: 0, max: 3, step: 0.05, hint: 'How much it swings with the body moving and turning.' },
            { key: 'lumpDamping', label: 'Swing settling', min: 0, max: 1, step: 0.01, hint: 'The swing of the whole: below 1 it wobbles back, 1 does not.' },
            { key: 'nodeDamping', label: 'Jiggle settling', min: 0, max: 1, step: 0.01, hint: 'The free end lagging behind the rest: below 1 it wobbles.' },
            { key: 'rigid', label: 'Turns about base', min: 0, max: 2, step: 0.05, hint: 'How much the swing turns about the base, like something hanging, rather than sliding.' },
            { key: 'turn', label: 'Swings on turns', min: 0, max: 3, step: 0.05, hint: 'How strongly turning swings it.' },
        ],
    },
    {
        id: 'volume', title: 'Volume', icon: 'bubble_chart', desc: 'How it keeps its volume when stretched or pressed.', sliders: [
            { key: 'volume', label: 'Keeps volume', min: 0, max: 1.5, step: 0.05, hint: 'Pulled down and out it lengthens and narrows, the volume kept.' },
            { key: 'bulge', label: 'Swells out', min: 0, max: 2, step: 0.05, hint: 'How much of the volume pressed in swells out elsewhere.' },
        ],
    },
    {
        id: 'walk', title: 'Walking', icon: 'directions_walk', late: true, desc: 'What a walk does to it.', sliders: [
            { key: 'rise', label: 'Bounce', min: 0, max: 0.3, step: 0.005, hint: 'How much a step bounces it, in blocks.' },
            { key: 'sway', label: 'Side to side', min: 0, max: 1, step: 0.01, hint: 'How much a walk sways it from side to side, in blocks.' },
        ],
    },
    {
        id: 'pair', title: 'Pair', icon: 'compare_arrows', late: true, when: 'pair', desc: 'How the two press on each other.', sliders: [
            { key: 'squeezeIn', label: 'Gives way', min: 0.01, max: 3, step: 0.01, hint: 'How quickly the two give way toward each other.' },
            { key: 'squeezeOut', label: 'Comes back', min: 0.01, max: 12, step: 0.05, hint: 'How quickly they come back apart.' },
            { key: 'squeezeStiffness', label: 'Pushes apart', min: 0, max: 8, step: 0.1, hint: 'How hard they push each other apart.' },
            { key: 'rim', label: 'Bulge at rim', min: 0, max: 2, step: 0.05, hint: 'How much they bulge out where they meet.' },
        ],
    },
    {
        id: 'hold', title: 'How it is held', icon: 'anchor', late: true, desc: 'How firmly each part is held to the animation, from the base to the tip. Leave these unless the look is wrong.', sliders: [
            { key: 'anchorFrom', label: 'Held from', min: 0, max: 1, step: 0.01, hint: 'Where, from the base to the tip, the nodes start to be free.' },
            { key: 'anchorHold', label: 'Held to', min: 0, max: 1, step: 0.01, hint: 'How much of the way along they stay held.' },
            { key: 'anchorFull', label: 'Free at', min: 0, max: 1, step: 0.01, hint: 'Where they are fully free.' },
            { key: 'shapeSoftness', label: 'Pull to shape', min: 0.1, max: 3, step: 0.05, hint: 'How soft the pull back to the cage form is.' },
            { key: 'shape', label: 'Shape strength', min: 0, max: 1, step: 0.01, hint: 'The pull back to the cage form.' },
            { key: 'link', label: 'Link strength', min: 0, max: 1, step: 0.01, hint: 'How firmly neighbouring nodes keep their distance.' },
            { key: 'gravity', label: 'Sag', min: -0.02, max: 0.02, step: 0.0005, hint: 'The sag each step.' },
            { key: 'reach', label: 'Share of reach', min: 0, max: 1, step: 0.01, hint: 'The share of the reach the region uses.' },
            { key: 'lumpShare', label: 'Lump share', min: 0, max: 1, step: 0.01, hint: 'The share of the inertia the whole region takes.' },
            { key: 'sideStiffness', label: 'Side stiffness', min: 0.1, max: 6, step: 0.1, hint: 'How much stiffer it is sideways.' },
            { key: 'stiffen', label: 'Stiffens', min: 0.05, max: 3, step: 0.05, hint: 'How soon a big swing stiffens.' },
        ],
    },
    {
        id: 'dressed', title: 'When dressed', icon: 'checkroom', late: true, desc: 'How it changes under clothes.', sliders: [
            { key: 'dressedStiffness', label: 'Firmer by', min: 0.1, max: 4, step: 0.05, hint: 'How much firmer it is under clothes.' },
            { key: 'dressedLimit', label: 'Travels', min: 0, max: 1, step: 0.01, hint: 'The share of its reach it keeps under clothes.' },
            { key: 'dressedCouple', label: 'Moves together', min: 0, max: 1, step: 0.01, hint: 'How much a pair moves together under clothes.' },
        ],
    },
];

export const KIND_OPTIONS = [
    { id: 'none', label: 'None', icon: 'block', title: 'This bone just follows the animation' },
    { id: 'spring', label: 'Spring', icon: 'vibration', title: 'One bone that jiggles: pouches, jowls, belly' },
    { id: 'chain', label: 'Chain', icon: 'link', title: 'This bone and the bones under it swing like rope: hair, tails, ears' },
    { id: 'cloth', label: 'Cloth', icon: 'checkroom', title: 'The vertices of this bone mesh hang and swing like cloth: a skirt, a cape' },
    { id: 'flesh', label: 'Flesh', icon: 'bubble_chart', title: 'The mesh (or the cubes) of this bone is soft: it swings, lags, keeps its volume and is pressed in' },
];

export const KIND_HELP: Record<PartKind, string> = {
    none: 'This bone only follows the animation. Pick a type to make it move on its own.',
    spring: 'One bone that swings about its pivot and settles back: a pouch, a jowl, a belly.',
    chain: 'This bone and the bones under it swing like a rope: hair, a tail, an ear.',
    cloth: 'The vertices of this bone mesh are the cloth: the top is sewn on, the rest hangs and swings.',
    flesh: 'A small cage is fitted to this bone and every vertex follows it. It swings as one lump, lags at its free end, keeps its volume and is pressed in by what touches it.',
};

export const KIND_ICONS: Record<string, string> = { spring: 'vibration', chain: 'link', cloth: 'checkroom', flesh: 'bubble_chart', none: '' };

// ---------------- the windows ----------------

/** The banner shown in every window while bones are being picked in the view for a list */
const PICK_BAR = `
  <div class="ph-pickbar" v-if="ui.picking"><i class="material-icons">touch_app</i><span>{{ ui.picking.text }}</span><button class="ph-btn on" @click="stopPicking">Done</button></div>`;

export const SIMULATE_TEMPLATE = `
<div class="ph ph-simulate">
  <div class="ph-bar">
    <button class="ph-play" :class="ui.running ? 'stop' : 'go'" @click="toggle" :title="ui.running ? 'Stop the simulation' : 'Run the physics on the model'"><i class="material-icons">{{ ui.running ? 'stop' : 'play_arrow' }}</i>{{ ui.running ? 'Stop' : 'Simulate' }}</button>
    <button class="ph-icon" :disabled="!ui.running" @click="reset" title="Start the motion again from the beginning"><i class="material-icons">replay</i></button>
    <button class="ph-icon" :disabled="!ui.running || !ui.selected" @click="poke" title="Kick the selected bone while it is simulating"><i class="material-icons">flash_on</i></button>
    <span class="ph-gap"></span>
    <button class="ph-icon" :class="{ on: ui.showColliders }" @click="ui.showColliders = !ui.showColliders; redraw()" :title="ui.showColliders ? 'Hide the collision shapes' : 'Show the collision shapes'"><i class="material-icons">{{ ui.showColliders ? 'visibility' : 'visibility_off' }}</i></button>
    <button class="ph-icon" :class="{ on: ui.showDebug }" @click="ui.showDebug = !ui.showDebug; redraw()" :title="ui.showDebug ? 'Hide the lines of springs, chains and flesh' : 'Show the lines of springs, chains and flesh'"><i class="material-icons">timeline</i></button>
    <button class="ph-icon" :disabled="!ui.canUndo" @click="undo" title="Undo the last change to the physics (Ctrl+Z)"><i class="material-icons">undo</i></button>
    <button class="ph-icon" :disabled="!ui.canRedo" @click="redo" title="Redo (Ctrl+Y)"><i class="material-icons">redo</i></button>
  </div>
  <div class="ph-status" :class="{ on: ui.running }"><span class="ph-dot"></span>{{ ui.running ? 'Simulating. Change anything and watch it.' : 'Stopped. Press Simulate to see the physics.' }}</div>
  <div class="ph-notice" v-if="ui.notice"><i class="material-icons">info</i><span>{{ ui.notice }}</span><button class="ph-x" @click="ui.notice = ''" title="Dismiss"><i class="material-icons">close</i></button></div>${PICK_BAR}
  <div class="ph-group">
    <div class="ph-group-title">Test motion</div>
    <div class="ph-field"><label>Move</label><select v-model="ui.motion"><option v-for="m in ui.motions" :value="m.id">{{ m.label }}</option></select></div>
    <div class="ph-hint" v-if="ui.help && motionDef.help">{{ motionDef.help }}</div>
    <template v-for="o in motionDef.options">
      <div class="ph-field" v-if="o.choices" :key="ui.motion + o.id"><label :title="o.hint">{{ o.label }}</label>
        <phys-seg :options="o.choices" :value="ui.motionOpts[ui.motion][o.id]" @input="setMotion(o.id, $event)"></phys-seg></div>
      <phys-slider v-else :key="ui.motion + o.id" :label="o.label" :hint="o.hint" :help="ui.help" :base="o.value" :min="o.min" :max="o.max" :step="o.step" :unit="o.unit" :value="ui.motionOpts[ui.motion][o.id]" @input="setMotion(o.id, $event)"></phys-slider>
    </template>
    <button class="ph-link" v-if="motionDef.options.length" @click="resetMotion">Put this move's settings back</button>
    <div class="ph-field"><label>Animation</label><select v-model="ui.animation"><option value="">None (rest pose)</option><option v-for="a in ui.animations" :value="a">{{ a }}</option></select></div>
    <phys-slider label="Speed" hint="How fast the move and the animation play." :help="ui.help" :base="1" :min="0.1" :max="1.5" :step="0.05" unit="x" :value="ui.speed" @input="ui.speed = $event"></phys-slider>
  </div>
  <div class="ph-group">
    <div class="ph-group-title">Camera</div>
    <div class="ph-hint" v-if="ui.help">Hold the camera on the model while it simulates, so the physics can be watched without the move in the way.</div>
    <phys-seg :options="camOptions" :value="ui.camMode" @input="camMode"></phys-seg>
    <template v-if="ui.camMode !== 'off'">
      <div class="ph-hint">{{ ui.camMode === 'bone' ? (ui.selected ? 'Held on ' + ui.selected + '.' : 'Pick a bone to hold it on; until then it is held on the model.') : 'Held on the model.' }} Turn off what it should not follow:</div>
      <phys-check label="Walking left and right" :value="ui.camX" @input="ui.camX = $event"></phys-check>
      <phys-check label="Walking forward and back" :value="ui.camZ" @input="ui.camZ = $event"></phys-check>
      <phys-check label="Going up and down" hint="Jumps." :help="ui.help" :value="ui.camY" @input="ui.camY = $event"></phys-check>
      <phys-check label="Turning" hint="The camera turns with the model, so a spin looks still." :help="ui.help" :value="ui.camTurn" @input="ui.camTurn = $event"></phys-check>
    </template>
  </div>
  <div class="ph-footer">
    <div class="ph-hint">{{ ui.summary }}</div>
    <div class="ph-problems" v-if="ui.problems.length"><div v-for="p in ui.problems.slice(0, 6)"><i class="material-icons">warning</i>{{ p }}</div></div>
  </div>
</div>`;

export const BONES_TEMPLATE = `
<div class="ph ph-bones">${PICK_BAR}
  <div class="ph-search"><i class="material-icons">search</i><input type="text" v-model="ui.query" placeholder="Search bones">
    <button class="ph-icon small" :class="{ on: ui.onlyPhysics }" @click="ui.onlyPhysics = !ui.onlyPhysics" title="Show only the bones that have physics"><i class="material-icons">filter_list</i></button>
    <button class="ph-icon small" @click="expandAll(true)" title="Open every branch"><i class="material-icons">unfold_more</i></button>
    <button class="ph-icon small" @click="expandAll(false)" title="Close every branch"><i class="material-icons">unfold_less</i></button>
  </div>
  <div class="ph-tree">
    <div v-for="n in visibleTree" :key="n.name" class="ph-node" :class="{ sel: ui.targets.includes(n.name) || n.name === ui.selected, main: n.name === ui.selected, off: offRow(n.name), choose: ui.picking && !offRow(n.name) }" :style="{ paddingLeft: (4 + n.depth * 14) + 'px' }" :title="offReason(n.name)" @click="pick(n.name, $event)">
      <span class="ph-twist" @click.stop="fold(n)"><i class="material-icons" v-if="n.hasKids && !ui.query && !ui.onlyPhysics">{{ ui.open[n.name] ? 'expand_more' : 'chevron_right' }}</i></span>
      <i class="material-icons ph-kind" :class="'k-' + n.kind" v-if="n.kind !== 'none'" :title="n.kind">{{ kindIcon(n.kind) }}</i>
      <span class="ph-name">{{ n.name }}</span>
      <i class="material-icons ph-listed" v-if="listedRow(n.name)" title="In the list">check_circle</i>
      <span class="ph-tag" v-if="n.auto !== 'auto'" :title="'Collision shape made from the model: ' + n.auto">{{ n.auto === 'off' ? 'no shape' : n.auto }}</span>
    </div>
    <div class="ph-hint" v-if="!visibleTree.length">No bones match.</div>
  </div>
  <div class="ph-foot">
    <span>{{ ui.targets.length > 1 ? ui.targets.length + ' bones picked' : ui.selected ? '1 bone picked' : 'Nothing picked' }}</span>
    <button class="ph-link" @click="pickPhysics" title="Pick every bone that has physics">All with physics</button>
    <button class="ph-link" v-if="ui.targets.length" @click="pickNone">Clear</button>
  </div>
  <div class="ph-hint tip">Click a bone here or in the view to pick it. Ctrl-click adds more, shift-click picks a run of the list. Whatever you change in Properties is changed on all the picked bones.</div>
</div>`;

export const PROPERTIES_TEMPLATE = `
<div class="ph ph-props">${PICK_BAR}
  <div class="ph-empty" v-if="!ui.selected"><i class="material-icons">touch_app</i><div>Pick a bone in the Bones window, or click one in the view, to give it physics. Ctrl-click adds more bones.</div></div>
  <div v-else>
    <div class="ph-title">
      <span class="ph-title-name">{{ ui.targets.length > 1 ? ui.targets.length + ' bones' : ui.selected }}</span><span class="ph-badge" :class="'k-' + ui.kind" v-if="ui.kind !== 'none'">{{ ui.kind }}</span>
      <span class="ph-gap"></span>
      <button class="ph-icon small" :class="{ on: ui.help }" @click="ui.help = !ui.help" title="Show or hide the description under each setting"><i class="material-icons">help_outline</i></button>
    </div>
    <div class="ph-multi" v-if="ui.targets.length > 1">
      <div class="ph-chips"><span class="ph-pick" v-for="b in ui.targets" :key="b">{{ b }}</span></div>
      <div class="ph-hint">{{ ui.mixed ? 'These are not all of one type. A change is made to the ones of the type shown (' + ui.kind + '); picking a type changes all of them.' : 'Whatever you change here is changed on every one of them.' }}</div>
    </div>
    <phys-seg :options="kindOptions" :value="ui.kind" @input="kind"></phys-seg>
    <div class="ph-hint">{{ kindHelp }}</div>

    <template v-if="ui.kind !== 'none'">
      <div class="ph-looks" v-if="looks.length"><span>Start from</span><button class="ph-chip" :class="{ on: lookOn(l.id) }" v-for="l in looks" :key="l.id" @click="look(l.id)" title="Start from this look; the settings stay yours to change">{{ l.label }}</button></div>

      <phys-sec v-for="g in earlyGroups" :key="ui.kind + ':' + g.id" :icon="g.icon" :title="g.title" :desc="g.desc" :open="groupOpen(g)" @toggle="toggleGroup(g)">
        <phys-slider v-for="s in g.sliders" :key="s.key" :label="s.label" :hint="s.hint" :help="ui.help" :base="defaults[s.key]" :min="s.min" :max="s.max" :step="s.step" :value="model[s.key]" @input="setField(s.key, $event)"></phys-slider>
      </phys-sec>

      <template v-if="ui.kind === 'flesh'">
        <phys-sec icon="account_tree" title="Region" desc="Which bones make up the flesh, and what its swing turns about." v-if="ui.targets.length < 2" :open="groupOpen({ id: 'region' })" @toggle="toggleGroup({ id: 'region' })">
          <div class="ph-sub-title">Pairs with</div>
          <phys-bones :items="partner ? [partner] : []" :active="ui.picking && ui.picking.kind === 'pair'" @remove="pairWith('')" @pick="togglePicking('pair')">Nothing: one bone.</phys-bones>
          <div class="ph-hint" v-if="ui.flesh.bones.length > 1">A pair presses on each other, flattens where they meet and bulges out at the rim.</div>
          <div class="ph-field"><label>Bones under it</label>
            <phys-seg :options="nestedOptions" :value="ui.flesh.nestedSoft ? 'soft' : 'rigid'" @input="nestedChoice"></phys-seg></div>
          <div class="ph-hint">{{ ui.flesh.nestedSoft ? 'The meshes on the bones under it are soft too, like its own.' : 'When it has a mesh of its own, the meshes on the bones under it ride on it as rigid pieces.' }}</div>
          <div class="ph-field"><label>Pivot</label>
            <phys-seg :options="pivotOptions" :value="ui.flesh.pivotMode" @input="pivotChoice"></phys-seg></div>
          <div class="ph-hint">{{ pivotHelp }}</div>
          <template v-if="ui.flesh.pivotMode === 'custom'">
            <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'pv' + i" :label="'Pivot ' + axis" :base="0" :min="-2" :max="3" :step="0.01" :value="ui.flesh.pivot[i]" @input="pivotAt(i, $event)"></phys-slider>
          </template>
          <div class="ph-field"><label>Free end</label><select :value="ui.flesh.tip" @change="axisChoice('tip', $event.target.value)"><option v-for="a in axes" :value="a">{{ a === 'auto' ? 'Auto' : a }}</option></select></div>
          <div class="ph-field"><label>Hangs from</label><select :value="ui.flesh.up" @change="axisChoice('up', $event.target.value)"><option v-for="a in axes" :value="a">{{ a === 'auto' ? 'Auto' : a }}</option></select></div>
          <div class="ph-hint">Change the last two only when the guess is wrong: the free end of the flesh and the side it hangs from, as an axis of the bone.</div>
        </phys-sec>

        <phys-sec icon="adjust" title="Soft zone" desc="Only the part inside the zone is soft; the rest is held as animated. Radius 0 makes all of the mesh soft." :open="groupOpen({ id: 'zone' })" @toggle="toggleGroup({ id: 'zone' })">
          <phys-slider label="Radius" :base="0" :min="0" :max="1.5" :step="0.01" :value="ui.flesh.softRadius" @input="setField('softRadius', $event)"></phys-slider>
          <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'zc' + i" :label="'Centre ' + axis" :base="0" :min="i === 1 ? -1 : -2" :max="i === 1 ? 3 : 2" :step="0.01" :value="ui.flesh.softCenter[i]" @input="centre(i, $event)"></phys-slider>
          <button class="ph-btn" @click="zone" title="Put the zone in the middle of this bone mesh, with half its reach as the radius"><i class="material-icons">center_focus_strong</i>Zone from the mesh</button>
        </phys-sec>

        <phys-sec icon="layers" title="Pieces that ride on it" desc="Other bones whose meshes move with this one as a rigid piece: a tip on a pouch." :badge="ui.flesh.carry.length ? ui.flesh.carry.length + '' : ''" :open="groupOpen({ id: 'carry' })" @toggle="toggleGroup({ id: 'carry' })">
          <phys-bones :items="ui.flesh.carry" :active="ui.picking && ui.picking.kind === 'carry'" @remove="carryOn($event, false)" @pick="togglePicking('carry')">None yet.</phys-bones>
        </phys-sec>
      </template>

      <template v-if="ui.kind === 'cloth'">
        <phys-sec icon="adjust" title="Soft zone" desc="Only the vertices inside the zone are soft; they blend to sewn on beyond it. Radius 0 makes all of the mesh soft." :open="groupOpen({ id: 'zone' })" @toggle="toggleGroup({ id: 'zone' })">
          <phys-slider label="Radius" :base="0" :min="0" :max="1.5" :step="0.01" :value="ui.soft.softRadius" @input="setField('softRadius', $event)"></phys-slider>
          <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'sc' + i" :label="'Centre ' + axis" :base="0" :min="i === 1 ? -1 : -2" :max="i === 1 ? 3 : 2" :step="0.01" :value="ui.soft.softCenter[i]" @input="centre(i, $event)"></phys-slider>
          <button class="ph-btn" @click="zone" title="Put the zone in the middle of this bone mesh, with half its reach as the radius"><i class="material-icons">center_focus_strong</i>Zone from the mesh</button>
        </phys-sec>
        <phys-sec icon="layers" title="Pieces that ride on it" desc="Other bones whose meshes move with this one as a rigid piece." :badge="ui.soft.carry.length ? ui.soft.carry.length + '' : ''" :open="groupOpen({ id: 'carry' })" @toggle="toggleGroup({ id: 'carry' })">
          <phys-bones :items="ui.soft.carry" :active="ui.picking && ui.picking.kind === 'carry'" @remove="carryOn($event, false)" @pick="togglePicking('carry')">None yet.</phys-bones>
        </phys-sec>
      </template>

      <phys-sec v-for="g in lateGroups" :key="ui.kind + ':' + g.id" :icon="g.icon" :title="g.title" :desc="g.desc" :open="groupOpen(g)" @toggle="toggleGroup(g)">
        <phys-slider v-for="s in g.sliders" :key="s.key" :label="s.label" :hint="s.hint" :help="ui.help" :base="defaults[s.key]" :min="s.min" :max="s.max" :step="s.step" :value="model[s.key]" @input="setField(s.key, $event)"></phys-slider>
      </phys-sec>

      <phys-sec icon="sports_mma" title="Collisions" desc="What it bumps into, or is pressed by." :open="groupOpen({ id: 'collide' })" @toggle="toggleGroup({ id: 'collide' })">
        <phys-check :label="collideLabels[0][0]" :hint="collideLabels[0][1]" :help="ui.help" :value="model.collideBody" @input="setField('collideBody', $event)"></phys-check>
        <phys-check :label="collideLabels[1][0]" :hint="collideLabels[1][1]" :help="ui.help" :value="model.collideWorld" @input="setField('collideWorld', $event)"></phys-check>
        <phys-check :label="collideLabels[2][0]" :hint="collideLabels[2][1]" :help="ui.help" :value="model.collideOthers" @input="setField('collideOthers', $event)"></phys-check>
        <div class="ph-field" v-if="ui.kind === 'flesh'"><label title="The model's own bones that press into it rather than being body it rests on. Names may start or end with *">Pressed by</label>
          <input type="text" :value="ui.flesh.presses.join(', ')" @change="pressesChoice($event.target.value)" placeholder="arm*, hand*"></div>
        <div class="ph-hint" v-if="ui.kind === 'flesh'">The bones named in Pressed by press into the flesh; the others are body it rests on. Names may start or end with *.</div>
        <template v-if="model.collideBody">
          <div class="ph-sub-title">Bones it reacts to <span>{{ ui.candidates.filter(b => isTicked(b)).length }} of {{ ui.candidates.length }}</span></div>
          <div class="ph-hint" v-if="!ui.candidates.length">{{ ui.kind === 'flesh' ? 'None of the model\\'s shapes press it yet: add a shape to a bone named above, or turn on Make shapes from the model in Shapes.' : 'No other bone has a shape for it to bump into yet: turn on Make shapes from the model in Shapes, or add shapes of your own.' }}</div>
          <template v-else>
<phys-bones :items="collideItems" :all="collideAll" :limit="10" :active="ui.picking && ui.picking.kind === 'collide'" @remove="untick" @pick="togglePicking('collide')">None of them.
              <template slot="tools"><button class="ph-chip" @click="setCollide('all')">All</button><button class="ph-chip" @click="setCollide('none')">None</button><button class="ph-chip" @click="setCollide('invert')">Invert</button></template></phys-bones>
          </template>
        </template>
      </phys-sec>

      <phys-sec icon="rotate_right" title="Angle limits" v-if="ui.kind === 'spring' || ui.kind === 'chain'" desc="How far the physics may turn the bone." :open="groupOpen({ id: 'limits' })" @toggle="toggleGroup({ id: 'limits' })">
        <phys-check label="Show them on the model" :value="ui.showLimits" @input="ui.showLimits = $event; redraw()"></phys-check>
        <div v-if="ui.kind === 'spring'">
          <div class="ph-hint">In degrees about each axis of the bone. The arcs show the range (x red, y green, z blue).</div>
          <div v-for="axis in ['x', 'y', 'z']" :key="axis" class="ph-limit">
            <phys-check :label="'Limit ' + axis.toUpperCase()" :value="!!ui.limits[axis]" @input="limitOn(axis, $event)"></phys-check>
            <template v-if="ui.limits[axis]">
              <phys-slider label="From" :min="-180" :max="0" :step="1" unit="°" :value="ui.limits[axis][0]" @input="setLimit(axis, 0, $event)"></phys-slider>
              <phys-slider label="To" :min="0" :max="180" :step="1" unit="°" :value="ui.limits[axis][1]" @input="setLimit(axis, 1, $event)"></phys-slider>
            </template>
          </div>
        </div>
        <div v-else>
          <div class="ph-hint">How far each segment may swing away from where the animation puts it. The cones show it. 0 is no limit.</div>
          <phys-slider label="Bend limit" :min="0" :max="150" :step="1" unit="°" :value="ui.controls.maxAngle" @input="setField('maxAngle', $event)"></phys-slider>
        </div>
      </phys-sec>

      <div class="ph-hint" v-if="ui.kind === 'flesh' || ui.kind === 'cloth'">The preview draws the simulated mesh with the model's texture in place of the original while it runs.</div>
    </template>
  </div>
</div>`;

export const SHAPES_TEMPLATE = `
<div class="ph ph-shapes">
  <div class="ph-group">
    <phys-check label="Make shapes from the model" hint="A box or capsule is made around the cubes of every bone, for parts to bump into." :help="ui.help" :value="ui.autoColliders !== false" @input="auto"></phys-check>
    <phys-check label="Show shapes" hint="Draw them on the model." :help="ui.help" :value="ui.showColliders" @input="ui.showColliders = $event; redraw()"></phys-check>
    <phys-check label="Show springs, chains and flesh" hint="Draw their rest and moved lines." :help="ui.help" :value="ui.showDebug" @input="ui.showDebug = $event; redraw()"></phys-check>
    <phys-check label="Show every shape" hint="Otherwise only those the picked bone bumps into." :help="ui.help" :value="ui.showAllShapes" @input="ui.showAllShapes = $event; redraw()"></phys-check>
    <div class="ph-hint">Lines: dim cyan are shapes made from the model, yellow are your own, white is the one you are editing.</div>
  </div>
  <div class="ph-empty" v-if="!ui.selected"><i class="material-icons">touch_app</i><div>Pick a bone to tag it or give it its own shapes.</div></div>
  <div class="ph-group" v-else>
    <div class="ph-group-title">{{ ui.targets.length > 1 ? ui.targets.length + ' bones' : ui.selected }}</div>
    <div class="ph-hint">Shape made from the cubes of {{ ui.targets.length > 1 ? 'each of them' : 'this bone' }}:</div>
    <phys-seg :options="autoOptions" :value="ui.autoMode" @input="setMode"></phys-seg>
    <template v-if="ui.targets.length < 2">
      <div class="ph-hint" v-if="ui.shapes.length">It has shapes of its own below, so none is made for it.</div>
      <div class="ph-sub-title">Its own shapes</div>
      <div class="ph-chips">
        <button class="ph-chip" v-for="s in ui.shapes" :key="s.index" :class="{ on: s.index === ui.shapeIndex }" @click="selectShape(s.index)">{{ s.label }}</button>
        <button class="ph-chip add" @click="shape('sphere')"><i class="material-icons">add</i>Sphere</button>
        <button class="ph-chip add" @click="shape('capsule')"><i class="material-icons">add</i>Capsule</button>
        <button class="ph-chip add" @click="shape('box')"><i class="material-icons">add</i>Box</button>
      </div>
      <div class="ph-card" v-if="ui.form">
        <phys-seg :options="shapeOptions" :value="ui.form.shape" @input="shapeKind"></phys-seg>
        <div class="ph-sub-title">Position <span>from the bone's pivot, in pixels</span></div>
        <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'c' + i" :label="axis" :min="-32" :max="32" :step="0.1" :value="ui.form.center[i]" @input="val('center', i, $event)"></phys-slider>
        <template v-if="ui.form.shape === 'box'">
          <div class="ph-sub-title">Size</div>
          <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'s' + i" :label="axis" :min="0.1" :max="32" :step="0.1" :value="ui.form.size[i]" @input="val('size', i, $event)"></phys-slider>
          <div class="ph-sub-title">Turn <span>degrees</span></div>
          <phys-slider v-for="(axis, i) in ['X', 'Y', 'Z']" :key="'r' + i" :label="axis" :min="-180" :max="180" :step="1" :value="ui.form.rotation[i]" @input="val('rotation', i, $event)"></phys-slider>
        </template>
        <template v-if="ui.form.shape === 'sphere'">
          <phys-slider label="Radius" :min="0.1" :max="16" :step="0.1" :value="ui.form.radius" @input="val('radius', 0, $event)"></phys-slider>
        </template>
        <template v-if="ui.form.shape === 'capsule'">
          <phys-slider label="Length" :min="0" :max="32" :step="0.1" :value="ui.form.length" @input="val('length', 0, $event)"></phys-slider>
          <phys-slider label="Radius" :min="0.1" :max="16" :step="0.1" :value="ui.form.radius" @input="val('radius', 0, $event)"></phys-slider>
          <div class="ph-sub-title">Tilt <span>degrees</span></div>
          <phys-slider label="X" :min="-180" :max="180" :step="1" :value="ui.form.rotation[0]" @input="val('rotation', 0, $event)"></phys-slider>
          <phys-slider label="Z" :min="-180" :max="180" :step="1" :value="ui.form.rotation[2]" @input="val('rotation', 2, $event)"></phys-slider>
        </template>
        <div class="ph-chips">
          <button class="ph-chip" @click="fitShape" title="Wrap it around this bone's cubes again"><i class="material-icons">crop_free</i>Fit to bone</button>
          <button class="ph-chip" @click="duplicateShape"><i class="material-icons">content_copy</i>Duplicate</button>
          <button class="ph-chip danger" @click="deleteShape"><i class="material-icons">delete</i>Delete</button>
        </div>
      </div>
    </template>
  </div>
</div>`;

export const OBJECTS_TEMPLATE = `
<div class="ph ph-objects">
  <div class="ph-hint">Things to bump into, only on this screen (not part of the model). Parts that collide with the floor and test objects feel them, and flesh is pressed in by them.</div>
  <div class="ph-tools">
    <button class="ph-chip add" @click="prop('sphere')"><i class="material-icons">add</i>Ball</button>
    <button class="ph-chip add" @click="prop('box')"><i class="material-icons">add</i>Block</button>
    <button class="ph-chip add" @click="prop('capsule')"><i class="material-icons">add</i>Pole</button>
    <button class="ph-chip add" @click="prop('wall')"><i class="material-icons">add</i>Wall</button>
    <button class="ph-chip danger" v-if="ui.props.length" @click="clearProps">Clear all</button>
  </div>
  <div class="ph-rows">
    <div class="ph-row" v-for="p in ui.props" :key="p.id" :class="{ sel: ui.selectedProp === p.id }" @click="selectProp(p.id)">
      <i class="material-icons">{{ propIcon(p) }}</i><span class="ph-name">{{ propName(p) }}</span>
      <span class="ph-tag" v-if="p.sweep">sweeps {{ p.sweepAxis.toUpperCase() }}</span>
      <button class="ph-icon small" @click.stop="dupProp(p.id)" title="Duplicate this object"><i class="material-icons">content_copy</i></button>
      <button class="ph-icon small" @click.stop="dropProp(p.id)" title="Remove this object"><i class="material-icons">close</i></button>
    </div>
    <div class="ph-empty" v-if="!ui.props.length"><i class="material-icons">category</i><div>No objects yet. Add one, then pick it here or in the view and use the gizmo: the move tool moves it, the rotate tool turns it and the scale tool resizes it.</div></div>
  </div>
  <div class="ph-group" v-if="object">
    <div class="ph-group-title">{{ propName(object) }}</div>
    <phys-sec sub icon="open_with" title="Transform" desc="Where it is, how it is turned and how big it is." :open="groupOpen({ id: 'obj-transform', open: true })" @toggle="toggleGroup({ id: 'obj-transform', open: true })">
      <phys-slider label="Left / right" :min="-3" :max="3" :step="0.02" :value="object.x" @input="object.x = $event; refreshProps()"></phys-slider>
      <phys-slider label="Up / down" :min="-1" :max="4" :step="0.02" :value="object.y" @input="object.y = $event; refreshProps()"></phys-slider>
      <phys-slider label="Forward / back" :min="-3" :max="3" :step="0.02" :value="object.z" @input="object.z = $event; refreshProps()"></phys-slider>
      <template v-if="object.kind !== 'sphere'">
        <phys-slider v-for="axis in ['x', 'y', 'z']" :key="'rot' + axis" :label="'Turn ' + axis.toUpperCase()" :min="-180" :max="180" :step="1" unit="°" :value="object['r' + axis]" @input="object['r' + axis] = $event; refreshProps()"></phys-slider>
      </template>
      <phys-slider label="Size" :min="0.1" :max="2.5" :step="0.02" :value="object.size" @input="object.size = $event; propsChanged()"></phys-slider>
    </phys-sec>
    <phys-sec sub icon="swap_horiz" title="Sweep" desc="Slides back and forth, so a moving thing can be tried against the model." :badge="object.sweep ? 'on' : ''" :open="groupOpen({ id: 'obj-sweep', open: true })" @toggle="toggleGroup({ id: 'obj-sweep', open: true })">
      <phys-check label="Sweeps back and forth" :value="object.sweep" @input="object.sweep = $event; refreshProps()"></phys-check>
      <template v-if="object.sweep">
        <div class="ph-field"><label>Direction</label><phys-seg :options="axisOptions" :value="object.sweepAxis" @input="object.sweepAxis = $event; refreshProps()"></phys-seg></div>
        <phys-slider label="Distance" :min="0.05" :max="3" :step="0.05" :value="object.sweepRange" @input="object.sweepRange = $event; refreshProps()"></phys-slider>
        <phys-slider label="Speed" :min="0.2" :max="8" :step="0.1" :value="object.sweepSpeed" @input="object.sweepSpeed = $event; refreshProps()"></phys-slider>
      </template>
    </phys-sec>
  </div>
</div>`;

export const JSON_TEMPLATE = `
<div class="ph ph-json">
  <div class="ph-bar">
    <span class="ph-jstatus" :class="ui.jsonOk ? 'ok' : 'bad'"><i class="material-icons">{{ ui.jsonOk ? 'check_circle' : 'error_outline' }}</i>{{ ui.jsonStatus }}</span>
    <span class="ph-gap"></span>
    <button class="ph-btn" @click="jsonFormat" title="Lay the text out neatly"><i class="material-icons">format_align_left</i>Format</button>
    <button class="ph-btn" @click="jsonRevert" title="Throw away what you typed and show the model's physics again"><i class="material-icons">restore</i>Revert</button>
    <button class="ph-btn" @click="jsonFill" title="Fill in a starter for the model's bones"><i class="material-icons">auto_fix_high</i>Starter</button>
  </div>
  <textarea class="ph-code" spellcheck="false" :value="ui.json" @input="jsonInput($event.target.value)" @focus="jsonFocus(true)" @blur="jsonFocus(false)" @keydown.tab.prevent="jsonTab($event)"></textarea>
  <div class="ph-problems" v-if="ui.jsonProblems.length"><div v-for="p in ui.jsonProblems.slice(0, 8)"><i class="material-icons">warning</i>{{ p }}</div></div>
  <div class="ph-hint">The same text the game reads. It is saved with the project and written into the exported .strutmodel, and changes you make in the other windows show here as you make them. Typing here applies after a pause, when the JSON is valid.</div>
</div>`;

export const CSS = `
.ph { padding: 0 0 12px; font-size: 12px; box-sizing: border-box; color: var(--color-text); overflow-y: auto; overscroll-behavior: contain; max-height: calc(100vh - 160px); }
.ph i.material-icons { font-size: 16px; line-height: 1; vertical-align: middle; flex: none; }
/* Blockbench gives every button a width and a height of its own: these start from none, and the rules below set what each kind needs */
:where(.ph) button { font: inherit; min-width: 0; height: auto; padding: 0; box-shadow: none; border-radius: 2px; line-height: 1.2; }
.ph button > i.material-icons { margin-right: 0; vertical-align: middle; pointer-events: none; }
:where(.ph) select { height: 26px; padding-top: 0; padding-bottom: 0; line-height: 26px; }
:where(.ph) input[type=range] { margin: 0; }
.ph-gap { flex: 1; }
.ph-bar { display: flex; align-items: center; gap: 4px; padding: 6px 8px 4px; }
.ph-play { display: inline-flex; align-items: center; gap: 4px; border: 0; padding: 5px 12px 5px 8px; font-weight: 600; cursor: pointer; color: #fff; }
.ph-play.go { background: #2f9e4f; }
.ph-play.go:hover { background: #37b25a; }
.ph-play.stop { background: #c2453f; }
.ph-play.stop:hover { background: #d2524b; }
.ph-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; background: var(--color-button); color: var(--color-text); cursor: pointer; padding: 0; flex: none; }
.ph-icon.small { width: 22px; height: 22px; background: transparent; }
.ph-icon:hover:not(:disabled) { background: var(--color-accent); color: var(--color-light); }
.ph-icon.on { background: var(--color-accent); color: var(--color-light); }
.ph-icon:disabled { opacity: .35; cursor: default; }
.ph-status { display: flex; align-items: center; gap: 6px; padding: 0 10px 6px; color: var(--color-subtle_text); }
.ph-dot { width: 8px; height: 8px; border-radius: 50%; background: #7a7f8a; flex: none; }
.ph-status.on .ph-dot { background: #43c463; box-shadow: 0 0 6px #43c463; }
.ph-notice { display: flex; align-items: flex-start; gap: 6px; margin: 0 8px 6px; padding: 6px 8px; background: var(--color-back); border-left: 3px solid var(--color-accent); line-height: 1.35; }
.ph-notice > span { flex: 1; }
.ph-notice i.material-icons { color: var(--color-accent); }
.ph-pickbar { display: flex; align-items: center; gap: 6px; margin: 4px 8px; padding: 6px 8px; background: var(--color-accent); color: var(--color-light); line-height: 1.3; position: sticky; top: 0; z-index: 3; }
.ph-pickbar > span { flex: 1; }
.ph-x { display: inline-flex; border: 0; background: transparent; color: var(--color-subtle_text); cursor: pointer; padding: 0; margin-left: auto; }
.ph-x:hover { color: var(--color-text); }
.ph-group { margin: 6px 8px; padding: 6px 8px 8px; background: var(--color-back); }
.ph-group-title { font-weight: 600; margin-bottom: 4px; }
.ph-title { display: flex; align-items: center; gap: 6px; padding: 8px 8px 2px; }
.ph-title-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-badge { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; background: var(--color-button); color: var(--color-subtle_text); }
.ph-badge.k-spring { background: #d0559a; color: #fff; }
.ph-badge.k-chain { background: #4d8fd6; color: #fff; }
.ph-badge.k-cloth { background: #3fae8c; color: #fff; }
.ph-badge.k-flesh { background: #e08a4a; color: #fff; }
.ph-props > div > .ph-hint, .ph-props > div > .ph-seg, .ph-props > div > .ph-looks, .ph-props > div > .ph-multi { margin-left: 8px; margin-right: 8px; }
.ph-looks { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; margin-bottom: 6px; }
.ph-looks > span { color: var(--color-subtle_text); margin-right: 2px; }
.ph-sec { margin: 6px 8px 0; background: var(--color-back); }
.ph-sec-head { display: flex; align-items: center; gap: 4px; padding: 6px 6px; cursor: pointer; user-select: none; font-weight: 600; }
.ph-sec-head:hover { background: var(--color-hover, rgba(255,255,255,.04)); }
.ph-sec-head i.material-icons { opacity: .75; }
.ph-sec-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-sec-badge { font-size: 10px; font-weight: 600; padding: 0 6px; border-radius: 8px; background: var(--color-accent); color: var(--color-light); }
.ph-sec-desc { padding: 0 10px 2px 28px; color: var(--color-subtle_text); line-height: 1.35; }
.ph-sec-body { padding: 4px 10px 10px; }
.ph-sec.sub { margin: 4px 0 0; background: var(--color-ui); }
.ph-field { display: grid; grid-template-columns: 86px 1fr; align-items: center; gap: 6px; margin: 4px 0; }
.ph-field > label { color: var(--color-subtle_text); }
.ph-field select, .ph-field input[type=text] { min-width: 0; width: 100%; box-sizing: border-box; }
.ph-inline { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ph-inline select { flex: 1; }
.ph-slider { margin: 5px 0 7px; }
.ph-slider-top { display: flex; align-items: center; gap: 6px; }
.ph-slider-top > label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-slider input[type=range] { width: 100%; min-width: 0; margin: 2px 0 0; display: block; }
.ph-slider input[type=number] { width: 62px; box-sizing: border-box; text-align: right; padding: 1px 4px; background: var(--color-dark); border: 1px solid transparent; color: var(--color-text); }
.ph-slider input[type=number]:focus { border-color: var(--color-accent); outline: 0; }
.ph-slider .ph-unit { color: var(--color-subtle_text); }
.ph-slider .ph-help { color: var(--color-subtle_text); line-height: 1.3; margin-top: 1px; }
.ph-seg { display: flex; margin: 4px 0; background: var(--color-dark); }
.ph-seg button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 3px; border: 0; background: transparent; color: var(--color-text); padding: 6px 2px; cursor: pointer; min-width: 0; }
.ph-seg button:hover:not(:disabled):not(.on) { background: var(--color-button); }
.ph-seg button.on { background: var(--color-accent); color: var(--color-light); }
.ph-seg button:disabled { opacity: .3; cursor: default; }
.ph-check { display: block; margin: 5px 0; cursor: pointer; }
.ph-check-row { display: flex; align-items: center; gap: 6px; }
.ph-check input { margin: 0; flex: none; }
.ph-check .ph-help { color: var(--color-subtle_text); line-height: 1.3; margin: 1px 0 0 20px; }
.ph-search { display: flex; align-items: center; gap: 2px; margin: 6px 8px; background: var(--color-dark); padding: 0 4px 0 6px; }
.ph-search input[type=text] { flex: 1; min-width: 0; background: transparent; border: 0; padding: 5px 4px; }
.ph-search i.material-icons { opacity: .6; }
.ph-tree { margin: 0 8px; max-height: calc(100vh - 330px); min-height: 120px; overflow-y: auto; background: var(--color-back); }
.ph-node { display: flex; align-items: center; gap: 4px; padding: 2px 6px 2px 4px; cursor: pointer; white-space: nowrap; min-height: 22px; }
.ph-node:hover { background: var(--color-button); }
.ph-node.sel { background: rgba(255,255,255,.1); }
.ph-node.main { background: var(--color-accent); color: var(--color-light); }
.ph-twist { display: inline-flex; width: 16px; justify-content: center; opacity: .8; flex: none; }
.ph-name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.ph-kind.k-spring { color: #d0559a; }
.ph-kind.k-chain { color: #4d8fd6; }
.ph-kind.k-cloth { color: #3fae8c; }
.ph-kind.k-flesh { color: #e08a4a; }
.ph-node.main .ph-kind { color: inherit; }
.ph-tag { font-size: 10px; padding: 0 6px; border-radius: 8px; color: #fff; background: #6b6f7a; flex: none; }
.ph-foot { display: flex; align-items: center; gap: 10px; margin: 4px 8px; color: var(--color-subtle_text); }
.ph-foot > span { flex: 1; }
.ph-link { border: 0; background: transparent; color: var(--color-accent); cursor: pointer; padding: 0; }
.ph-link:hover { text-decoration: underline; }
.ph-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.ph-tools { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 8px; }
.ph-group .ph-tools, .ph-sec-body .ph-tools { margin-left: 0; margin-right: 0; }
.ph-chip { display: inline-flex; align-items: center; gap: 2px; border: 0; background: var(--color-button); color: var(--color-text); padding: 3px 8px; cursor: pointer; border-radius: 2px; }
.ph-chip:hover { background: var(--color-accent); color: var(--color-light); }
.ph-chip.on { background: var(--color-accent); color: var(--color-light); }
.ph-chip.add { padding-left: 4px; }
.ph-chip.danger:hover { background: #c2453f; }
.ph-btn { display: inline-flex; align-items: center; gap: 4px; border: 0; background: var(--color-button); color: var(--color-text); padding: 4px 10px; cursor: pointer; margin: 4px 0; }
.ph-btn:hover, .ph-btn.on { background: var(--color-accent); color: var(--color-light); }
.ph-pickbar .ph-btn { margin: 0; background: rgba(0,0,0,.25); }
.ph-list { display: flex; flex-direction: column; gap: 2px; max-height: 170px; overflow-y: auto; background: var(--color-dark); padding: 4px 6px; margin: 4px 0; }
.ph-list label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.ph-card { background: var(--color-ui); padding: 4px 8px 6px; margin: 6px 0; }
.ph-reset { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 0; background: transparent; color: var(--color-subtle_text); cursor: pointer; padding: 0; flex: none; }
.ph-reset i.material-icons { font-size: 14px; }
.ph-reset:hover:not(:disabled) { background: var(--color-accent); color: var(--color-light); }
.ph-reset.off { visibility: hidden; }
.ph-node.off { opacity: .35; cursor: not-allowed; }
.ph-node.off:hover { background: transparent; }
.ph-node.choose { cursor: crosshair; }
.ph-listed { color: #40ffa0; }
.ph-all { color: var(--color-subtle_text); }
.ph-sub-title { font-weight: 600; margin: 8px 0 2px; }
.ph-sub-title span { font-weight: 400; color: var(--color-subtle_text); margin-left: 4px; }
.ph-limit { margin: 4px 0 6px; }
.ph-hint { color: var(--color-subtle_text); margin: 4px 0; line-height: 1.4; }
.ph-hint.tip { margin: 6px 10px; }
.ph-empty { display: flex; gap: 8px; align-items: center; color: var(--color-subtle_text); padding: 10px 10px; line-height: 1.4; }
.ph-empty i.material-icons { font-size: 22px; opacity: .6; }
.ph-pick { display: inline-flex; align-items: center; gap: 2px; background: var(--color-accent); color: var(--color-light); padding: 0 6px; border-radius: 8px; font-size: 11px; }
.ph-pick i.material-icons { font-size: 13px; cursor: pointer; opacity: .8; }
.ph-pick i.material-icons:hover { opacity: 1; }
.ph-rows { margin: 4px 8px; }
.ph-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 6px; cursor: pointer; background: var(--color-back); margin-bottom: 1px; min-height: 26px; }
.ph-row:hover { background: var(--color-button); }
.ph-row.sel { background: var(--color-accent); color: var(--color-light); }
.ph-problems { color: #e0a040; margin: 4px 8px; line-height: 1.35; }
.ph-problems i.material-icons { font-size: 14px; margin-right: 3px; }
.ph-footer { padding: 4px 10px 0; }
.ph-json { display: flex; flex-direction: column; max-height: none; height: 100%; }
.ph-jstatus { display: inline-flex; align-items: center; gap: 4px; }
.ph-jstatus.ok i.material-icons { color: #43c463; }
.ph-jstatus.bad i.material-icons { color: #e0a040; }
.ph-code { flex: 1; min-height: 120px; margin: 0 8px; resize: none; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.4; tab-size: 2; white-space: pre; background: var(--color-dark); color: var(--color-text); border: 1px solid var(--color-border); padding: 6px 8px; width: calc(100% - 16px); }
.ph-code:focus { border-color: var(--color-accent); outline: 0; }
`;
