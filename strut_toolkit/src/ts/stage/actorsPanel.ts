/* eslint-disable @typescript-eslint/no-explicit-any */
import { STRUT_WORKSPACE_ID } from '../constants';
import { actorRows, ActorRow, removeActor, setActorVisible } from './stageProject';

/**
 * The Actors panel of a workspace: who is in the scene, with the model each one is wearing, and what can be done to each: show or hide, change who they are, give them
 * another model of the same skeleton, take them out. It only shows what {@code stageProject.ts} reads from the project and calls what it is given for the dialogs
 */

export interface ActorPanelHandlers {
    add(): void;
    edit(role: string): void;
    swap(role: string): void;
}

let panel: any = null;
let styles: any = null;

const CSS = `
    .strut_actors { padding: 6px; }
    .strut_actors .strut_actor { display: flex; align-items: center; gap: 4px; padding: 4px 6px; margin-bottom: 4px; background: var(--color-back); border: 1px solid var(--color-border); border-radius: 3px; }
    .strut_actors .strut_actor.hidden_actor { opacity: 0.55; }
    .strut_actors .strut_actor_text { flex: 1; min-width: 0; line-height: 1.25; }
    .strut_actors .strut_actor_role { font-weight: bold; }
    .strut_actors .strut_actor_note { color: var(--color-subtle_text); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .strut_actors .strut_actor_button { cursor: pointer; padding: 2px 3px; border-radius: 3px; }
    .strut_actors .strut_actor_button:hover { background: var(--color-button); color: var(--color-light); }
    .strut_actors .strut_actor_add { display: inline-block; cursor: pointer; padding: 4px 10px; background: var(--color-button); border-radius: 3px; margin-top: 2px; }
    .strut_actors .strut_actor_empty { color: var(--color-subtle_text); padding: 6px 2px 10px; }
`;

export function createActorsPanel(handlers: ActorPanelHandlers): void {
    const Panel_ = (globalThis as any).Panel;

    if (!Panel_ || panel)
        return;

    styles = (Blockbench as any).addCSS(CSS);
    panel = new Panel_('strut_actors', {
        name: 'Actors',
        icon: 'groups',
        growable: true,
        resizable: true,
        condition: { formats: [STRUT_WORKSPACE_ID], modes: ['animate'] },
        default_position: { slot: 'left_bar', float_position: [0, 0], float_size: [300, 300], height: 300 },
        component: {
            data() {
                return { rows: [] as ActorRow[] };
            },
            created(this: any) {
                this.refresh();
                this.timer = setInterval(() => this.refresh(), 700);
            },
            beforeDestroy(this: any) {
                clearInterval(this.timer);
            },
            methods: {
                refresh(this: any) {
                    if ((globalThis as any).Format?.id !== STRUT_WORKSPACE_ID) {
                        this.rows = [];

                        return;
                    }

                    const rows = actorRows();

                    // only when something changed, so the list does not redraw under the mouse
                    if (JSON.stringify(rows) !== JSON.stringify(this.rows))
                        this.rows = rows;
                },
                add() {
                    handlers.add();
                },
                toggle(this: any, row: ActorRow) {
                    setActorVisible(row.role, !row.visible);
                    this.refresh();
                },
                edit(row: ActorRow) {
                    handlers.edit(row.role);
                },
                swap(row: ActorRow) {
                    handlers.swap(row.role);
                },
                remove(this: any, row: ActorRow) {
                    (Blockbench as any).showMessageBox({
                        title: 'Remove actor',
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
            },
            template: `
                <div class="strut_actors">
                    <div v-if="rows.length === 0" class="strut_actor_empty">No actors yet. Add the characters this scene is animated with: their models and textures are loaded for you.</div>
                    <div v-for="row in rows" :key="row.role" class="strut_actor" :class="{hidden_actor: !row.visible}">
                        <div class="strut_actor_text">
                            <div class="strut_actor_role">{{ row.role }}<span v-if="row.lead"> (lead)</span><span v-if="!row.required"> (optional)</span></div>
                            <div class="strut_actor_note" :title="row.skeleton">{{ row.skeleton }}</div>
                            <div class="strut_actor_note" :title="row.model">{{ row.model }}</div>
                        </div>
                        <i class="material-icons strut_actor_button" title="Show or hide" @click="toggle(row)">{{ row.visible ? 'visibility' : 'visibility_off' }}</i>
                        <i class="material-icons strut_actor_button" title="Who this actor is" @click="edit(row)">edit</i>
                        <i class="material-icons strut_actor_button" title="Give it another model" @click="swap(row)">swap_horiz</i>
                        <i class="material-icons strut_actor_button" title="Remove" @click="remove(row)">delete</i>
                    </div>
                    <div class="strut_actor_add" @click="add()"><i class="material-icons" style="vertical-align: middle;">person_add</i> Add actor</div>
                </div>`,
        },
    });
}

export function deleteActorsPanel(): void {
    panel?.delete?.();
    panel = null;
    styles?.delete?.();
    styles = null;
}
