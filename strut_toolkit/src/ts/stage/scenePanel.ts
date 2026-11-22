/* eslint-disable @typescript-eslint/no-explicit-any */
import { STRUT_WORKSPACE_ID } from '../constants';
import { ActorRow, removeActor, sceneOverview, SceneOverview, setActorVisible } from './stageProject';

/**
 * The Scene panel of Strut Scenes: what the scene is for, who is in it, which clips it still needs, and the two things to do at the end (check it, export it)
 * <p>
 * It is the whole of the scene in one place, read from what {@code stageProject.ts} reports ({@link sceneOverview}, which reads no keys so the panel can ask often).
 * Each role the scene's kind has is a row that is empty until a character is put in it; each phase of the kind is a row that says what clips it still needs and makes
 * the next one with one press, named and set as the kind says. A scene of no particular kind lists its characters and clips and lets the person name them
 */

export interface ScenePanelHandlers {
    addCharacter(slotId: string): void;
    /** A character the scene's kind has no role for, from a preset */
    addOther(): void;
    /** The same, from files */
    addFromFiles(): void;
    edit(role: string): void;
    swap(role: string): void;
    addClip(phaseId?: string): void;
    settings(): void;
    check(): void;
    export(): void;
}

let panel: any = null;
let styles: any = null;

const CSS = `
    .strut_scene { padding: 6px; }
    .strut_scene .strut_scene_head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .strut_scene .strut_scene_title { flex: 1; min-width: 0; }
    .strut_scene .strut_scene_name { font-weight: bold; }
    .strut_scene .strut_scene_kind { color: var(--color-subtle_text); font-size: 0.85em; }
    .strut_scene h4 { margin: 10px 0 4px 0; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-subtle_text); }
    .strut_scene .strut_row { display: flex; align-items: center; gap: 4px; padding: 4px 6px; margin-bottom: 4px; background: var(--color-back); border: 1px solid var(--color-border); border-radius: 3px; }
    .strut_scene .strut_row.empty { border-style: dashed; }
    .strut_scene .strut_row.hidden_actor { opacity: 0.55; }
    .strut_scene .strut_text { flex: 1; min-width: 0; line-height: 1.25; }
    .strut_scene .strut_title { font-weight: bold; }
    .strut_scene .strut_note { color: var(--color-subtle_text); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .strut_scene .strut_wrap { white-space: normal; }
    .strut_scene .strut_bad { color: var(--color-error, #e06c75); }
    .strut_scene .strut_ok { color: var(--color-accent, #98c379); }
    .strut_scene .strut_button { cursor: pointer; padding: 2px 3px; border-radius: 3px; }
    .strut_scene .strut_button:hover { background: var(--color-button); color: var(--color-light); }
    .strut_scene .strut_chip { display: inline-block; cursor: pointer; margin: 2px 4px 0 0; padding: 0 6px; border-radius: 9px; background: var(--color-button); font-size: 0.85em; }
    .strut_scene .strut_chip:hover { filter: brightness(1.2); }
    .strut_scene .strut_wide { display: inline-block; cursor: pointer; padding: 4px 10px; margin: 2px 6px 0 0; background: var(--color-button); border-radius: 3px; }
    .strut_scene .strut_wide:hover { filter: brightness(1.15); }
    .strut_scene .strut_primary { background: var(--color-accent, #3a7bd5); color: var(--color-light, #fff); }
    .strut_scene .strut_empty { color: var(--color-subtle_text); padding: 4px 2px 8px; }
    .strut_scene .strut_footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--color-border); }
    .strut_scene .strut_status { margin-bottom: 6px; }
`;

export function createScenePanel(handlers: ScenePanelHandlers): void {
    const Panel_ = (globalThis as any).Panel;

    if (!Panel_ || panel)
        return;

    styles = (Blockbench as any).addCSS(CSS);
    panel = new Panel_('strut_scene', {
        name: 'Scene',
        icon: 'theaters',
        growable: true,
        resizable: true,
        condition: { formats: [STRUT_WORKSPACE_ID], modes: ['animate'] },
        default_position: { slot: 'left_bar', float_position: [0, 0], float_size: [320, 460], height: 460 },
        component: {
            data() {
                return { overview: null as SceneOverview | null };
            },
            created(this: any) {
                this.refresh();
                this.timer = setInterval(() => this.refresh(), 700);
            },
            beforeDestroy(this: any) {
                clearInterval(this.timer);
            },
            computed: {
                todo(this: any): number {
                    const o: SceneOverview | null = this.overview;

                    if (!o)
                        return 0;

                    return o.slots.filter(slot => slot.required && !slot.actor).length + o.phases.filter(phase => phase.missing.length > 0).length;
                },
            },
            methods: {
                refresh(this: any) {
                    if ((globalThis as any).Format?.id !== STRUT_WORKSPACE_ID) {
                        this.overview = null;

                        return;
                    }

                    const next = sceneOverview();

                    // only when something changed, so the panel does not redraw under the mouse
                    if (JSON.stringify(next) !== JSON.stringify(this.overview))
                        this.overview = next;
                },
                addCharacter(slotId: string) {
                    handlers.addCharacter(slotId);
                },
                addOther() {
                    handlers.addOther();
                },
                addFromFiles() {
                    handlers.addFromFiles();
                },
                edit(row: ActorRow) {
                    handlers.edit(row.role);
                },
                swap(row: ActorRow) {
                    handlers.swap(row.role);
                },
                toggle(this: any, row: ActorRow) {
                    setActorVisible(row.role, !row.visible);
                    this.refresh();
                },
                remove(this: any, row: ActorRow) {
                    (Blockbench as any).showMessageBox({
                        title: 'Remove character',
                        message: `Remove ${row.role}? Its model, textures and keyframes go with it.`,
                        buttons: ['Remove', 'Cancel'],
                        confirm: 0,
                        cancel: 1,
                    }, (button: number) => {
                        if (button === 0) {
                            removeActor(row.role);
                            this.refresh();
                        }
                    });
                },
                addClip(phaseId?: string) {
                    handlers.addClip(phaseId);
                },
                select(name: string) {
                    ((globalThis as any).Animation?.all as any[] ?? []).find(animation => animation.name === name)?.select();
                },
                settings() {
                    handlers.settings();
                },
                check() {
                    handlers.check();
                },
                exportScene() {
                    handlers.export();
                },
            },
            template: `
                <div class="strut_scene" v-if="overview">
                    <div class="strut_scene_head">
                        <div class="strut_scene_title">
                            <div class="strut_scene_name">{{ overview.scene || 'unnamed scene' }}</div>
                            <div class="strut_scene_kind">{{ overview.templateName || 'no kind of scene' }}{{ overview.namespace ? ' · ' + overview.namespace : '' }}</div>
                        </div>
                        <i class="material-icons strut_button" title="Kind of scene, name and namespace" @click="settings()">settings</i>
                    </div>

                    <h4>Characters</h4>
                    <div v-for="slot in overview.slots" :key="slot.id" class="strut_row" :class="{empty: !slot.actor, hidden_actor: slot.actor && !slot.actor.visible}">
                        <div class="strut_text">
                            <div class="strut_title">{{ slot.name }}<span v-if="slot.lead"> (lead)</span><span v-if="!slot.required"> (optional)</span></div>
                            <div class="strut_note" :title="slot.actor ? slot.actor.skeleton : slot.description">{{ slot.actor ? slot.actor.model || slot.actor.skeleton : (slot.description || (slot.skeleton ? 'on ' + slot.skeleton : 'nobody yet')) }}</div>
                        </div>
                        <template v-if="slot.actor">
                            <i class="material-icons strut_button" title="Show or hide" @click="toggle(slot.actor)">{{ slot.actor.visible ? 'visibility' : 'visibility_off' }}</i>
                            <i class="material-icons strut_button" title="Who this character is" @click="edit(slot.actor)">edit</i>
                            <i class="material-icons strut_button" title="Give it another model" @click="swap(slot.actor)">swap_horiz</i>
                            <i class="material-icons strut_button" title="Remove" @click="remove(slot.actor)">delete</i>
                        </template>
                        <span v-else class="strut_wide strut_primary" @click="addCharacter(slot.id)">Add</span>
                    </div>
                    <div v-for="row in overview.others" :key="row.role" class="strut_row" :class="{hidden_actor: !row.visible}">
                        <div class="strut_text">
                            <div class="strut_title">{{ row.role }}</div>
                            <div class="strut_note" :title="row.skeleton">{{ row.model || row.skeleton }}</div>
                        </div>
                        <i class="material-icons strut_button" title="Show or hide" @click="toggle(row)">{{ row.visible ? 'visibility' : 'visibility_off' }}</i>
                        <i class="material-icons strut_button" title="Who this character is" @click="edit(row)">edit</i>
                        <i class="material-icons strut_button" title="Give it another model" @click="swap(row)">swap_horiz</i>
                        <i class="material-icons strut_button" title="Remove" @click="remove(row)">delete</i>
                    </div>
                    <div v-if="overview.slots.length === 0 && overview.others.length === 0" class="strut_empty">Nobody yet. Add the characters this scene is animated with: their models and textures are loaded for you.</div>
                    <div>
                        <span class="strut_wide" @click="addOther()" title="A ready-made character: its model, texture, role and skeleton ID"><i class="material-icons" style="vertical-align: middle; font-size: 16px;">groups</i> {{ overview.slots.length ? 'Another from a preset' : 'From a preset' }}</span>
                        <span class="strut_wide" @click="addFromFiles()" title="A model file and its textures"><i class="material-icons" style="vertical-align: middle; font-size: 16px;">person_add</i> {{ overview.slots.length ? 'Another from files' : 'From files' }}</span>
                    </div>

                    <h4>Clips</h4>
                    <template v-if="!overview.free">
                        <div v-for="phase in overview.phases" :key="phase.id" class="strut_row">
                            <i class="material-icons" :class="phase.missing.length ? (phase.required || phase.clips.length ? 'strut_bad' : '') : 'strut_ok'" :title="phase.missing.join('; ')">{{ phase.missing.length ? (phase.required || phase.clips.length ? 'error_outline' : 'radio_button_unchecked') : 'check_circle' }}</i>
                            <div class="strut_text">
                                <div class="strut_title">{{ phase.name }}<span v-if="phase.required"> *</span></div>
                                <div class="strut_note strut_wrap" v-if="phase.description && !phase.clips.length">{{ phase.description }}</div>
                                <div class="strut_note strut_wrap strut_bad" v-if="phase.missing.length">{{ phase.missing.join('; ') }}</div>
                                <div><span v-for="clip in phase.clips" :key="clip" class="strut_chip" :title="clip" @click="select(clip)">{{ clip.split('.').pop() }}</span></div>
                            </div>
                            <i class="material-icons strut_button" :title="'Add a ' + phase.name + ' clip'" @click="addClip(phase.id)">add_circle</i>
                        </div>
                    </template>
                    <template v-else>
                        <div v-if="!overview.clips.length" class="strut_empty">No clips yet.</div>
                        <div><span v-for="clip in overview.clips" :key="clip" class="strut_chip" :title="clip" @click="select(clip)">{{ clip.split('.').pop() }}</span></div>
                        <div style="margin-top: 4px;"><span class="strut_wide" @click="addClip()"><i class="material-icons" style="vertical-align: middle; font-size: 16px;">add</i> Add a clip</span></div>
                    </template>

                    <div class="strut_footer">
                        <div class="strut_status" :class="todo ? '' : 'strut_ok'">{{ todo ? todo + (todo === 1 ? ' thing' : ' things') + ' still to do' : 'Nothing missing' }}</div>
                        <span class="strut_wide" @click="check()">Check</span>
                        <span class="strut_wide strut_primary" @click="exportScene()">Export</span>
                    </div>
                </div>
                <div class="strut_scene" v-else><div class="strut_empty">This project is not a scene yet. Open Scene Settings to start one.</div><span class="strut_wide strut_primary" @click="settings()">Scene Settings</span></div>`,
        },
    });
}

export function deleteScenePanel(): void {
    panel?.delete?.();
    panel = null;
    styles?.delete?.();
    styles = null;
}
