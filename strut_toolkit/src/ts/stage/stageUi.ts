/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidSkeletonId } from '../binary/skeletonId';
import { decodeModel, MODEL_EXTENSION } from '../binary/model';
import { isStrutWorkspace } from '../utils';
import { actorGroups, addActor, exportWorkspaceFiles, metaOrNew, readMeta, readStage, removeActor, swapActorModel, writeMeta } from './stageProject';
import { Problem } from './stageFormat';
import { ImageFile, matchTextures } from './textureMatch';
import { workspaceFormat } from './workspaceFormat';
import { createActorsPanel, deleteActorsPanel } from './actorsPanel';

/**
 * The workspace's menu actions and dialogs. They only collect what the user types and call {@code stageProject.ts}; nothing here decides how a workspace is read or
 * exported
 */

type Model = ReturnType<typeof decodeModel>;

function problemsText(problems: readonly Problem[]): string {
    return problems.map(problem => `${problem.severity === 'error' ? 'Error' : 'Warning'}: ${problem.message}`).join('\n');
}

function showProblems(title: string, problems: readonly Problem[]): void {
    (Blockbench as any).showMessageBox({
        title,
        message: problems.length === 0 ? 'Nothing is wrong.' : problemsText(problems),
        buttons: ['OK'],
    });
}

function say(title: string, message: string): void {
    (Blockbench as any).showMessageBox({ title, message, buttons: ['OK'] });
}

/** Asks for a {@code .strutmodel} and calls {@code then} with it decoded */
function pickModel(then: (model: Model, name: string) => void): void {
    (Blockbench as any).import({
        resource_id: 'strut_model',
        type: 'Strut Binary Model',
        extensions: [MODEL_EXTENSION],
        readtype: 'binary',
    }, (files: any[]) => {
        const file = files[0];

        if (!file)
            return;

        try {
            then(decodeModel(new Uint8Array(file.content as ArrayBuffer), file.name || 'model.strutmodel'), String(file.name ?? 'model'));
        }
        catch (error) {
            say('Could not read the model', (error as Error).message);
        }
    });
}

/** Asks whether to choose the model's textures now, then for the image files; calls {@code then} with what was chosen (none if skipped) */
function pickTextures(modelName: string, textureNames: readonly string[], then: (files: ImageFile[]) => void): void {
    if (textureNames.length === 0) {
        then([]);

        return;
    }

    (Blockbench as any).showMessageBox({
        title: 'Textures',
        message: `${modelName} uses ${textureNames.length === 1 ? 'the texture' : 'the textures'} ${textureNames.map(name => `"${name}"`).join(', ')}. Choose the image files now? They are matched by name, and kept in the workspace.`,
        buttons: ['Choose images...', 'Skip (placeholders)'],
        confirm: 0,
        cancel: 1,
    }, (button: number) => {
        if (button !== 0) {
            then([]);

            return;
        }

        (Blockbench as any).import({
            resource_id: 'strut_texture',
            type: 'PNG Image',
            extensions: ['png'],
            readtype: 'image',
            multiple: true,
        }, (files: any[]) => then(files.map(file => ({ name: String(file.name ?? ''), content: String(file.content ?? '') }))));
    });
}

function textureReport(model: Model, files: readonly ImageFile[]): { images: ReadonlyMap<string, string>; note: string } {
    const match = matchTextures(model.textures.map(texture => texture.name), files);
    const notes: string[] = [];

    if (match.missing.length > 0)
        notes.push(`No image for ${match.missing.map(name => `"${name}"`).join(', ')}: it is drawn as a placeholder.`);

    if (match.unused.length > 0)
        notes.push(`Not used: ${match.unused.join(', ')}.`);

    return { images: match.images, note: notes.join(' ') };
}

function list(text: string): string[] {
    return text.split(',').map(part => part.trim()).filter(part => part !== '');
}

// ===============================================================
// Actors
// ===============================================================

/** Add Actor: a model and its textures, and who it is in the scene */
export function addActorDialog(): void {
    pickModel((model, name) => pickTextures(name, model.textures.map(texture => texture.name), files => addActorDetails(model, name, files)));
}

function addActorDetails(model: Model, name: string, files: readonly ImageFile[]): void {
    const report = textureReport(model, files);
    const section = model.extensions?.get('strut:skeleton');
    const own = section ? new TextDecoder().decode(section.subarray(2)) : '';

    new (Dialog as any)({
        id: 'strut_add_actor',
        title: `Add Actor (${name})`,
        form: {
            ...(report.note ? { textures: { label: 'Textures', type: 'info', text: report.note } } : {}),
            role: { label: 'Role', type: 'text', value: '', placeholder: 'host', description: 'The scene role this actor is exported as' },
            skeleton: { label: 'Skeleton ID', type: 'text', value: own, placeholder: 'my_modid:creature', description: 'The skeleton this actor is animated for; the model must be on it' },
            compatible: { label: 'Also fits', type: 'text', value: '', description: 'Other skeleton IDs that may fill the role, separated by commas' },
            required: { label: 'Required', type: 'checkbox', value: true, description: 'The scene cannot start without this role' },
            lead: { label: 'Lead role', type: 'checkbox', value: false },
            camera: { label: 'Camera bone', type: 'text', value: '', description: 'The bone a player in this role looks out of' },
        },
        onConfirm(form: any) {
            try {
                if (!isValidSkeletonId(form.skeleton))
                    throw new Error(`"${form.skeleton}" is not a skeleton ID (a namespace, a colon and a path, such as my_modid:creature)`);

                const compatible = list(String(form.compatible));

                addActor(String(form.role).trim(), String(form.skeleton).trim(), model, name, {
                    ...(compatible.length > 0 ? { compatible } : {}),
                    ...(form.required === false ? { required: false } : {}),
                    ...(form.lead ? { lead: true } : {}),
                    ...(String(form.camera).trim() !== '' ? { camera: String(form.camera).trim() } : {}),
                }, report.images);
            }
            catch (error) {
                say('Could not add the actor', (error as Error).message);

                return false;
            }
        },
    }).show();
}

/** Swap Model: another model of the same skeleton for the actor; every keyframe stays */
export function swapModelDialog(role: string): void {
    pickModel((model, name) => pickTextures(name, model.textures.map(texture => texture.name), files => {
        const report = textureReport(model, files);

        try {
            const dropped = swapActorModel(role, model, name, report.images);
            const notes = [report.note, dropped > 0 ? `${dropped} tracks were for bones the new model does not have, and were dropped.` : ''].filter(note => note !== '');

            if (notes.length > 0)
                say('Model swapped', notes.join('\n'));
        }
        catch (error) {
            say('Could not swap the model', (error as Error).message);
        }
    }));
}

/** Edit Actor: who the actor is for the scene (which role it is is the name of its group); with no role, asks which actor */
export function editActorDialog(role?: string): void {
    const meta = readMeta();
    const roles = [...actorGroups().keys()];

    if (role !== undefined && meta?.actors[role]) {
        editActorDetails(meta, role);

        return;
    }

    if (!meta || roles.length === 0) {
        say('Edit Actor', 'The workspace has no actors yet.');

        return;
    }

    new (Dialog as any)({
        id: 'strut_edit_actor',
        title: 'Edit Actor',
        form: {
            role: { label: 'Actor', type: 'select', options: Object.fromEntries(roles.map(each => [each, each])), value: roles[0] },
        },
        onConfirm(pick: any) {
            setTimeout(() => editActorDetails(meta, String(pick.role)), 0);
        },
    }).show();
}

function editActorDetails(meta: NonNullable<ReturnType<typeof readMeta>>, role: string): void {
    const actor = meta.actors[role];

    if (!actor)
        return;

    new (Dialog as any)({
        id: 'strut_edit_actor_details',
        title: `Actor ${role}`,
        form: {
            skeleton: { label: 'Skeleton ID', type: 'text', value: actor.skeleton },
            compatible: { label: 'Also fits', type: 'text', value: (actor.compatible ?? []).join(', ') },
            required: { label: 'Required', type: 'checkbox', value: actor.required !== false },
            lead: { label: 'Lead role', type: 'checkbox', value: actor.lead === true },
            camera: { label: 'Camera bone', type: 'text', value: actor.camera ?? '' },
            remove: { label: 'Remove this actor', type: 'checkbox', value: false, description: 'Takes the actor, its model, its textures and its keyframes out of the workspace' },
        },
        onConfirm(form: any) {
            if (form.remove) {
                removeActor(role);

                return;
            }

            if (!isValidSkeletonId(form.skeleton)) {
                say('Not saved', `"${form.skeleton}" is not a skeleton ID`);

                return false;
            }

            actor.skeleton = String(form.skeleton).trim();
            actor.compatible = list(String(form.compatible));
            actor.required = form.required !== false;
            actor.lead = form.lead === true;
            actor.camera = String(form.camera).trim();
            writeMeta(meta);
        },
    }).show();
}

// ===============================================================
// The scene
// ===============================================================

/** Workspace Settings: the scene's name and the namespace its layout is written under; also what a new workspace asks first */
export function workspaceSettingsDialog(): void {
    const meta = metaOrNew(String((Project as any).name || 'scene'), '');

    new (Dialog as any)({
        id: 'strut_workspace_settings',
        title: 'Workspace Settings',
        form: {
            scene: { label: 'Scene', type: 'text', value: meta.scene, placeholder: 'doggy', description: 'The scene\'s name: it names the layout and the clip sets' },
            namespace: { label: 'Namespace', type: 'text', value: meta.namespace, placeholder: 'my_modid', description: 'The namespace the scene layout is written under' },
        },
        onConfirm(form: any) {
            meta.scene = String(form.scene).trim().toLowerCase().replace(/[^a-z0-9_/-]+/g, '_');
            meta.namespace = String(form.namespace).trim().toLowerCase();
            writeMeta(meta);
            animateOnly();
        },
    }).show();
}

/** Animation Tags: what the selected animation is called in the layout (a mod's own words), and each actor's shift in time */
export function animationTagsDialog(): void {
    const animation = (Animation as any).selected;
    const roles = [...actorGroups().keys()];

    if (!animation) {
        say('Animation Tags', 'Select an animation first.');

        return;
    }

    const meta = metaOrNew(String((Project as any).name || 'scene'), '');
    const tags = meta.animations[animation.name] ?? {};
    const form: Record<string, any> = {
        phase: { label: 'Phase', type: 'text', value: tags.phase ?? '', description: 'What part of the scene this clip is, in the mod\'s own words; written to the layout and never worked out from the name' },
        variant: { label: 'Variant', type: 'number', value: tags.variant ?? 0, min: 0, step: 1, description: 'Which of several clips of the phase this is, counting from 1; 0 for none' },
        side: { label: 'Side', type: 'text', value: tags.side ?? '' },
    };

    for (const role of roles)
        form[`shift_${role}`] = { label: `${role} shift (s)`, type: 'number', value: tags.shifts?.[role] ?? 0, step: 0.05, description: 'Seconds this actor\'s keys and events are moved later (or earlier) against the others on export' };

    new (Dialog as any)({
        id: 'strut_animation_tags',
        title: `Animation Tags: ${animation.name}`,
        form,
        onConfirm(values: any) {
            const shifts: Record<string, number> = {};

            for (const role of roles) {
                const shift = Number(values[`shift_${role}`]) || 0;

                if (shift !== 0)
                    shifts[role] = shift;
            }

            meta.animations[animation.name] = {
                ...(String(values.phase).trim() ? { phase: String(values.phase).trim() } : {}),
                ...(Number(values.variant) > 0 ? { variant: Math.floor(Number(values.variant)) } : {}),
                ...(String(values.side).trim() ? { side: String(values.side).trim() } : {}),
                ...(Object.keys(shifts).length > 0 ? { shifts } : {}),
            };
            writeMeta(meta);
        },
    }).show();
}

export function checkWorkspace(): void {
    const { files, problems } = exportWorkspaceFiles();

    showProblems(files.length > 0 ? 'Workspace Check' : 'Workspace Check: it cannot be exported yet', problems);
}

/** Writes the exported files: into a folder when Blockbench has a file system (the app), else as one zip */
export function exportWorkspace(): void {
    const { files, problems } = exportWorkspaceFiles();

    if (files.length === 0) {
        showProblems('The workspace cannot be exported yet', problems);

        return;
    }

    const done = (where: string): void => {
        say('Workspace exported', `${files.length} files written to ${where}.` + (problems.length > 0 ? `\n\n${problemsText(problems)}` : ''));
    };

    if ((Blockbench as any).isApp && typeof (Blockbench as any).pickDirectory === 'function') {
        const directory = (Blockbench as any).pickDirectory({ title: 'Export the workspace into the pack folder', resource_id: 'strut_workspace' });

        if (!directory)
            return;

        for (const file of files) {
            const content = file.bytes !== undefined ? file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) : file.text;

            (Blockbench as any).writeFile(`${directory}/${file.path}`, { content, savetype: file.bytes !== undefined ? 'buffer' : 'text', custom_writer: null }, undefined);
        }

        done(String(directory));

        return;
    }

    // the web version has no folders: one zip, with the same paths inside
    const zip = new (globalThis as any).JSZip();

    for (const file of files)
        zip.file(file.path, file.bytes ?? file.text ?? '');

    zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
        const link = document.createElement('a');

        link.href = URL.createObjectURL(blob);
        link.download = `${readStage().stage?.scene ?? 'workspace'}.zip`;
        link.click();
        done('a zip download');
    });
}

// ===============================================================
// Wiring
// ===============================================================

/** Sets the workspace project type up: its new project dialog and the Actors panel */
export function loadStageUi(): void {
    Blockbench.on('select_project', animateOnly);
    Blockbench.on('load_project', animateOnly);
    createActorsPanel({ add: addActorDialog, edit: editActorDialog, swap: swapModelDialog });
}

/** A workspace is for animating only: it is opened in Animate mode (it has no Edit mode to start in) */
function animateOnly(): void {
    if (isStrutWorkspace() && Mode.selected?.id !== 'animate')
        (Modes as any).options.animate.select();
}

export function unloadStageUi(): void {
    Blockbench.removeListener('select_project', animateOnly);
    Blockbench.removeListener('load_project', animateOnly);
    deleteActorsPanel();
    workspaceFormat.delete();
}

/** The actions, for the Tools menu */
export function createStageMenuItems(): { action: Action; menuCategory: string }[] {
    const item = (id: string, name: string, icon: string, description: string, click: () => void): { action: Action; menuCategory: string } => ({
        action: new (Action as any)(id, { name, icon, description, category: 'edit', condition: isStrutWorkspace, click }),
        menuCategory: 'tools',
    });

    return [
        item('strut_workspace_add_actor', 'Workspace: Add Actor...', 'person_add', 'Add a model and its textures as an actor of this workspace: it is loaded for you, animated with the normal tools, and exported per actor', addActorDialog),
        item('strut_workspace_edit_actor', 'Workspace: Edit Actor...', 'manage_accounts', 'Change who an actor is for the scene, or remove it', () => editActorDialog()),
        item('strut_workspace_settings', 'Workspace: Settings...', 'settings', 'The scene\'s name and the namespace its files are written under', workspaceSettingsDialog),
        item('strut_workspace_animation_tags', 'Workspace: Animation Tags...', 'label', 'The selected animation\'s phase, variant and side for the layout, and each actor\'s shift in time', animationTagsDialog),
        item('strut_workspace_check', 'Workspace: Check', 'fact_check', 'Check the workspace for what would stop an export or make it wrong', checkWorkspace),
        {
            action: new (Action as any)('strut_workspace_export', {
                name: 'Export Workspace...',
                icon: 'save',
                description: 'Export every actor\'s clips into its clip set, and the scene\'s layout',
                category: 'file',
                condition: isStrutWorkspace,
                click: exportWorkspace,
            }),
            menuCategory: 'file.export',
        },
    ];
}
