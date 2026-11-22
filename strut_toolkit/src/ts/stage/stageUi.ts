/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidSkeletonId } from '../binary/skeletonId';
import { decodeModel, MODEL_EXTENSION } from '../binary/model';
import { isStrutWorkspace } from '../utils';
import { actorGroups, addActor, addClipForPhase, addFreeClip, exportWorkspaceFiles, metaOrNew, readMeta, readStage, removeActor, sceneOverview, SlotRow, swapActorModel, unlockGeometry, writeMeta } from './stageProject';
import { SceneTemplate } from './sceneTemplate';
import { installApi, registry, uninstallApi } from './templateRegistry';
import { Problem } from './stageFormat';
import { ImageFile, matchTextures } from './textureMatch';
import { workspaceFormat } from './workspaceFormat';
import { createScenePanel, deleteScenePanel } from './scenePanel';
import { startTour } from '../tour/tourManager';
import { loadTimelineGrouping, unloadTimelineGrouping } from './timelineGrouping';
import { ActorPreset, freeRole, loadPresets, readFile, readFolders, writeFolders } from './actorPresets';

/**
 * The Strut Scenes menu actions and dialogs. They only collect what the user types and call {@code stageProject.ts}; nothing here decides how a scene is read or exported
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

/** The "no side" choice of a phase whose sides are optional (a select has no empty option) */
const NO_SIDE = '__none';

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

/** What a role of the scene's template says about whoever fills it, for the actor's own data */
function slotExtra(slot: SlotRow | null): { compatible?: string[]; required?: boolean; lead?: boolean; camera?: string } {
    const role = slot ? readMeta()?.template?.roles.find(each => each.id === slot.id) : undefined;

    return role ? {
        ...(role.compatible.length > 0 ? { compatible: [...role.compatible] } : {}),
        ...(!role.required ? { required: false } : {}),
        ...(role.lead ? { lead: true } : {}),
        ...(role.camera !== '' ? { camera: role.camera } : {}),
    } : {};
}

/** Add Character from files: a model and its textures; for a role of the scene (a slot) it is the one the scene asks for */
export function addActorDialog(slot: SlotRow | null = null): void {
    pickModel((model, name) => pickTextures(name, model.textures.map(texture => texture.name), files => addActorDetails(model, name, files, slot)));
}

function addActorDetails(model: Model, name: string, files: readonly ImageFile[], slot: SlotRow | null = null): void {
    const report = textureReport(model, files);
    const section = model.extensions?.get('strut:skeleton');
    const own = section ? new TextDecoder().decode(section.subarray(2)) : '';

    new (Dialog as any)({
        id: 'strut_add_actor',
        title: slot ? `Add ${slot.name} (${name})` : `Add Character (${name})`,
        form: {
            ...(report.note ? { textures: { label: 'Textures', type: 'info', text: report.note } } : {}),
            // a role of the scene is fixed; a character the scene has no role for is named
            ...(slot ? {} : { role: { label: 'Role', type: 'text', value: '', placeholder: 'host', description: 'The scene role this character is exported as' } }),
            skeleton: { label: 'Skeleton ID', type: 'text', value: slot && slot.skeleton !== '' ? slot.skeleton : own, placeholder: 'my_modid:creature', description: 'The skeleton this character is animated for; the model must be on it' },
            ...(slot ? {} : {
                compatible: { label: 'Also fits', type: 'text', value: '', description: 'Other skeleton IDs that may fill the role, separated by commas' },
                required: { label: 'Required', type: 'checkbox', value: true, description: 'The scene cannot start without this role' },
                lead: { label: 'Lead role', type: 'checkbox', value: false },
                camera: { label: 'Camera bone', type: 'text', value: '', description: 'The bone a player in this role looks out of' },
            }),
        },
        onConfirm(form: any) {
            try {
                if (!isValidSkeletonId(form.skeleton))
                    throw new Error(`"${form.skeleton}" is not a skeleton ID (a namespace, a colon and a path, such as my_modid:creature)`);

                const compatible = list(String(form.compatible ?? ''));
                const extra = slot ? slotExtra(slot) : {
                    ...(compatible.length > 0 ? { compatible } : {}),
                    ...(form.required === false ? { required: false } : {}),
                    ...(form.lead ? { lead: true } : {}),
                    ...(String(form.camera ?? '').trim() !== '' ? { camera: String(form.camera).trim() } : {}),
                };

                addActor(slot ? slot.id : String(form.role).trim(), String(form.skeleton).trim(), model, name, extra, report.images);
            }
            catch (error) {
                say('Could not add the character', (error as Error).message);

                return false;
            }
        },
    }).show();
}

// ===============================================================
// Actor presets
// ===============================================================

function storage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    }
    catch {
        return null;
    }
}

/** Add Character from a preset: one from the registered preset folders, loaded with its texture and its skeleton ID. For a role of the scene (a slot) only those that can fill it are offered */
export function addPresetDialog(slot: SlotRow | null = null): void {
    const folders = readFolders(storage());

    if (folders.length === 0) {
        say('Character presets', 'No preset folder is registered yet. A preset folder holds ready-made characters (a model, its texture, its role and skeleton ID). A tool that makes them registers its folder by itself; you can also add one by hand.');
        presetFoldersDialog();

        return;
    }

    void loadPresets(folders).then(({ presets, problems }) => {
        if (presets.length === 0) {
            say('Character presets', `There is no usable preset in the registered folders.${problems.length > 0 ? `\n\n${problems.join('\n')}` : ''}`);

            return;
        }

        const taken = new Set(actorGroups().keys());
        const template = readMeta()?.template;
        const wanted = slot ? template?.roles.find(each => each.id === slot.id) : undefined;
        // those that fit the role: its skeleton or one it also takes, else the heading the role asks for, else all of them
        const fitting = wanted ? presets.filter(preset => wanted.skeleton === '' ? wanted.presetGroup === '' || preset.group === wanted.presetGroup : preset.skeleton === wanted.skeleton || wanted.compatible.includes(preset.skeleton)) : presets;
        const offered = fitting.length > 0 ? fitting : presets;

        new (Dialog as any)({
            id: 'strut_add_preset',
            title: slot ? `Add ${slot.name} from a preset` : 'Add Character from a preset',
            form: {
                ...(problems.length > 0 ? { problems: { label: 'Left out', type: 'info', text: problems.join(' ') } } : {}),
                ...(fitting.length === 0 && wanted ? { none: { label: 'Note', type: 'info', text: `No preset is on the skeleton ${wanted.skeleton || 'this role asks for'}, so all are listed.` } } : {}),
                preset: { label: 'Character', type: 'select', options: Object.fromEntries(offered.map((preset, index) => [String(index), `${preset.group}: ${preset.name}`])), value: '0' },
                ...(slot ? {} : { role: { label: 'Role', type: 'text', value: '', placeholder: 'the preset\'s own', description: 'The scene role this character is exported as; left empty it is the preset\'s role' } }),
            },
            onConfirm(form: any) {
                const preset = offered[Number(form.preset)];

                if (!preset)
                    return false;

                const named = String(form.role ?? '').trim();
                const role = slot ? slot.id : named !== '' ? named : freeRole(preset.role, taken);

                void addPresetActor(preset, role, slotExtra(slot));
            },
        }).show();
    });
}

/** Loads the preset's model and textures and adds it as an actor */
async function addPresetActor(preset: ActorPreset, role: string, extra: { compatible?: string[]; required?: boolean; lead?: boolean; camera?: string } = {}): Promise<void> {
    try {
        const file = await readFile(preset.model, 'binary');

        if (!file || !(file.content instanceof ArrayBuffer))
            throw new Error(`the model ${preset.model} could not be read`);

        const model = decodeModel(new Uint8Array(file.content), file.name || `${preset.id}.strutmodel`);
        const images: ImageFile[] = [];

        for (const path of preset.textures) {
            const image = await readFile(path, 'image');

            if (image && typeof image.content === 'string')
                images.push({ name: path, content: image.content });
        }

        const report = textureReport(model, images);

        addActor(role, preset.skeleton, model, preset.name, {
            ...(preset.compatible.length > 0 ? { compatible: [...preset.compatible] } : {}),
            ...(preset.camera !== '' ? { camera: preset.camera } : {}),
            ...extra,
        }, report.images);

        if (report.note !== '')
            say('Character added', report.note);
    }
    catch (error) {
        say('Could not add the character', (error as Error).message);
    }
}

/**
 * Adds the character for a role of the scene: a preset when there are presets, else a file. One question: where does the character come from
 */
export function addCharacterDialog(slotId: string): void {
    const slot = sceneOverview()?.slots.find(each => each.id === slotId) ?? null;

    if (!slot)
        return;

    const hasPresets = readFolders(storage()).length > 0;

    if (!hasPresets) {
        addActorDialog(slot);

        return;
    }

    (Blockbench as any).showMessageBox({
        title: `Add ${slot.name}`,
        message: `${slot.description !== '' ? `${slot.description}\n\n` : ''}Where does the character come from?${slot.skeleton !== '' ? `\nIt must be on the skeleton ${slot.skeleton}.` : ''}`,
        buttons: ['A preset', 'A model file...', 'Cancel'],
        confirm: 0,
        cancel: 2,
    }, (button: number) => {
        if (button === 0)
            addPresetDialog(slot);
        else if (button === 1)
            addActorDialog(slot);
    });
}

/** The folders the presets are looked for in: add one, or forget them all */
export function presetFoldersDialog(): void {
    const folders = readFolders(storage());

    (Blockbench as any).showMessageBox({
        title: 'Character preset folders',
        message: folders.length === 0 ? 'No folders are registered.' : `Registered folders:\n${folders.join('\n')}`,
        buttons: ['Add a folder...', ...(folders.length > 0 ? ['Forget them all'] : []), 'Close'],
        confirm: 0,
        cancel: folders.length > 0 ? 2 : 1,
    }, (button: number) => {
        if (button === 0) {
            if (!(Blockbench as any).isApp || typeof (Blockbench as any).pickDirectory !== 'function') {
                say('Character preset folders', 'Folders can only be chosen in the desktop app.');

                return;
            }

            const directory = (Blockbench as any).pickDirectory({ title: 'A folder with a presets.json', resource_id: 'strut_actor_presets' });

            if (directory)
                writeFolders(storage(), [...folders, String(directory)]);
        }
        else if (button === 1 && folders.length > 0) {
            writeFolders(storage(), []);
        }
    });
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
        say('Edit Character', 'The scene has no characters yet.');

        return;
    }

    new (Dialog as any)({
        id: 'strut_edit_actor',
        title: 'Edit Character',
        form: {
            role: { label: 'Character', type: 'select', options: Object.fromEntries(roles.map(each => [each, each])), value: roles[0] },
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
        title: `Character ${role}`,
        form: {
            skeleton: { label: 'Skeleton ID', type: 'text', value: actor.skeleton },
            compatible: { label: 'Also fits', type: 'text', value: (actor.compatible ?? []).join(', ') },
            required: { label: 'Required', type: 'checkbox', value: actor.required !== false },
            lead: { label: 'Lead role', type: 'checkbox', value: actor.lead === true },
            camera: { label: 'Camera bone', type: 'text', value: actor.camera ?? '' },
            remove: { label: 'Remove this character', type: 'checkbox', value: false, description: 'Takes the character, its model, its textures and its keyframes out of the scene' },
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

/** Scene Settings: what kind of scene it is, its name and the namespace its files are written under; also what a new scene asks first */
export function workspaceSettingsDialog(): void {
    void sceneSettings();
}

async function sceneSettings(): Promise<void> {
    // the templates other tools keep in folders are read now, so a scene can be made of one the moment it is registered
    await registry.refreshFolders(storage());

    const meta = metaOrNew(String((Project as any).name || 'scene'), '');
    const entries = registry.list();
    const options = Object.fromEntries(entries.map(entry => [entry.template.id, `${entry.template.group}: ${entry.template.name}`]));
    const current = meta.template && options[meta.template.id] ? meta.template.id : meta.template ? '' : 'strut:free';
    // a scene made from a template that is no longer registered keeps the template it was made with
    const withKept = meta.template && !options[meta.template.id] ? { ...options, [meta.template.id]: `${meta.template.group}: ${meta.template.name} (kept with the scene)` } : options;
    const notes = registry.problems.length > 0 ? { problems: { label: 'Left out', type: 'info', text: registry.problems.join(' ') } } : {};

    new (Dialog as any)({
        id: 'strut_scene_settings',
        title: meta.template || Object.keys(meta.actors).length > 0 ? 'Scene Settings' : 'New Strut Scene',
        form: {
            ...notes,
            template: { label: 'Kind of scene', type: 'select', options: withKept, value: current || meta.template?.id || 'strut:free', description: 'What roles it has and which clips it needs. The scene is checked against it, and the panel lists what is missing' },
            scene: { label: 'Scene', type: 'text', value: meta.scene, placeholder: 'tango', description: 'The scene\'s name: it names the layout and the clip sets' },
            namespace: { label: 'Namespace', type: 'text', value: meta.namespace, placeholder: 'my_modid', description: 'The namespace the scene layout is written under' },
        },
        onConfirm(form: any) {
            const chosen: SceneTemplate | undefined = registry.get(String(form.template)) ?? (meta.template?.id === form.template ? meta.template : undefined);

            if (chosen)
                meta.template = chosen;

            meta.scene = String(form.scene).trim().toLowerCase().replace(/[^a-z0-9_/-]+/g, '_');
            meta.namespace = String(form.namespace).trim().toLowerCase();
            writeMeta(meta);
            animateOnly();
        },
    }).show();
}

/** A free scene named practice, made without asking: what the tour of making a scene follows along in */
export async function startPracticeScene(): Promise<void> {
    workspaceFormat.new();
    await new Promise(resolve => setTimeout(resolve, 600));

    const dialog = (Dialog as any).open;

    // the new scene's own questions are answered for the person
    if (dialog?.id === 'strut_scene_settings') {
        dialog.setFormValues({ template: 'strut:free', scene: 'practice', namespace: 'practice' });
        await dialog.confirm();
        await new Promise(resolve => setTimeout(resolve, 600));
    }
}

/** Add a clip: for a phase of the scene's kind it is made as the kind names and sets it; a scene with no phases is asked for a name */
export function addClipDialog(phaseId?: string): void {
    const meta = readMeta();
    const template = meta?.template;
    const phase = template?.phases.find(each => each.id === phaseId);

    if (!meta)
        return;

    if (phase && phase.sides.length === 0) {
        if (addClipForPhase(phase.id) === null)
            say('Add a clip', `${phase.name} already has all its ${phase.variants.max} variants.`);

        return;
    }

    if (phase) {
        new (Dialog as any)({
            id: 'strut_add_clip_side',
            title: `Add a clip: ${phase.name}`,
            form: {
                side: {
                    label: 'Side',
                    type: 'select',
                    options: { ...(phase.sidesOptional ? { [NO_SIDE]: 'No side (one plain clip)' } : {}), ...Object.fromEntries(phase.sides.map(side => [side, side])) },
                    value: phase.sidesOptional ? NO_SIDE : phase.sides[0],
                    description: phase.sidesOptional
                        ? `Only some scenes have sides: leave it at "no side" for one plain clip, or make the clips for ${phase.sidesRequired.join(' and ')}${phase.sides.length > phase.sidesRequired.length ? ` (and ${phase.sides.filter(side => !phase.sidesRequired.includes(side)).join(', ')} if the scene has them)` : ''}`
                        : 'Each variant of this phase has one clip for each side',
                },
            },
            onConfirm(form: any) {
                const side = String(form.side) === NO_SIDE ? '' : String(form.side);

                if (addClipForPhase(phase.id, side) === null)
                    say('Add a clip', `${phase.name} already has all its ${phase.variants.max} variants${side !== '' ? ` for ${side}` : ''}.`);
            },
        }).show();

        return;
    }

    new (Dialog as any)({
        id: 'strut_add_free_clip',
        title: 'Add a clip',
        form: {
            name: { label: 'Name', type: 'text', value: `animation.${meta.scene || 'scene'}.`, description: 'The clip\'s name; every character of the scene plays the clip of this name from its own file' },
        },
        onConfirm(form: any) {
            const name = String(form.name).trim();

            if (name === '' || ((Project as any).animations as any[] ?? []).some(animation => animation.name === name)) {
                say('Add a clip', name === '' ? 'A clip needs a name.' : `There already is a clip called ${name}.`);

                return false;
            }

            addFreeClip(name);
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

    showProblems(files.length > 0 ? 'Scene Check' : 'Scene Check: it cannot be exported yet', problems);
}

/** Writes the exported files: into a folder when Blockbench has a file system (the app), else as one zip */
export function exportWorkspace(): void {
    const { files, problems } = exportWorkspaceFiles();

    if (files.length === 0) {
        showProblems('The scene cannot be exported yet', problems);

        return;
    }

    const done = (where: string): void => {
        say('Scene exported', `${files.length} files written to ${where}.` + (problems.length > 0 ? `\n\n${problemsText(problems)}` : ''));
    };

    if ((Blockbench as any).isApp && typeof (Blockbench as any).pickDirectory === 'function') {
        const directory = (Blockbench as any).pickDirectory({ title: 'Export the scene into the pack folder', resource_id: 'strut_workspace' });

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
        link.download = `${readStage().stage?.scene ?? 'scene'}.zip`;
        link.click();
        done('a zip download');
    });
}

// ===============================================================
// Wiring
// ===============================================================

/** Sets the Strut Scenes project type up: its Scene panel, and the API other plugins add templates through */
export function loadStageUi(): void {
    Blockbench.on('select_project', animateOnly);
    Blockbench.on('load_project', animateOnly);
    installApi();
    loadTimelineGrouping();
    void registry.refreshFolders(storage());
    createScenePanel({
        addCharacter: addCharacterDialog,
        addOther: () => addPresetDialog(),
        addFromFiles: () => addActorDialog(),
        edit: editActorDialog,
        swap: swapModelDialog,
        addClip: addClipDialog,
        settings: workspaceSettingsDialog,
        tour: () => startTour('scenes'),
        check: checkWorkspace,
        export: exportWorkspace,
    });
}

/**
 * The Variable Placeholders panel is for Molang a scene does not use: it is not shown in a scene unless the person asks for it (Strut Scenes: Show or Hide Variable
 * Placeholders, in the View menu). It is hidden by taking it out of the panels that are shown, so the person's own layout of it in other projects is left as it was
 */
let originalVariablesCondition: any = null;
let variablesShown = false;

function applyVariablesVisibility(): void {
    const panel = (globalThis as any).Panels?.variable_placeholders;

    if (!panel)
        return;

    if (originalVariablesCondition === null)
        originalVariablesCondition = panel.condition ?? true;

    const original = originalVariablesCondition;

    panel.condition = () => (globalThis as any).Condition(original) && (!isStrutWorkspace() || variablesShown);
    (globalThis as any).updateInterface?.();
}

function restoreVariables(): void {
    const panel = (globalThis as any).Panels?.variable_placeholders;

    if (panel && originalVariablesCondition !== null) {
        panel.condition = originalVariablesCondition;
        originalVariablesCondition = null;
        (globalThis as any).updateInterface?.();
    }
}

export function toggleVariablePlaceholders(): void {
    variablesShown = !variablesShown;
    applyVariablesVisibility();
}

/** A scene is for animating only: it is opened in Animate mode (a scene has no Edit mode to start in) */
function animateOnly(): void {
    if (!isStrutWorkspace())
        return;

    unlockGeometry();
    applyVariablesVisibility();

    if (Mode.selected?.id !== 'animate')
        (Modes as any).options.animate.select();
}

export function unloadStageUi(): void {
    Blockbench.removeListener('select_project', animateOnly);
    Blockbench.removeListener('load_project', animateOnly);
    unloadTimelineGrouping();
    restoreVariables();
    deleteScenePanel();
    uninstallApi();
    workspaceFormat.delete();
}

/** The actions, for the Tools menu */
export function createStageMenuItems(): { action: Action; menuCategory: string }[] {
    const item = (id: string, name: string, icon: string, description: string, click: () => void): { action: Action; menuCategory: string } => ({
        action: new (Action as any)(id, { name, icon, description, category: 'edit', condition: isStrutWorkspace, click }),
        menuCategory: 'tools',
    });

    return [
        item('strut_workspace_add_actor', 'Strut Scenes: Add Character from a File...', 'person_add', 'Add a model and its textures as a character of this scene: it is loaded for you, animated with the normal tools, and exported character by character', () => addActorDialog()),
        item('strut_workspace_add_preset', 'Strut Scenes: Add Character from a Preset...', 'groups', 'Add a ready-made character (its model, texture, role and skeleton ID) from the registered preset folders', () => addPresetDialog()),
        item('strut_workspace_preset_folders', 'Strut Scenes: Character Preset Folders...', 'folder_open', 'The folders ready-made characters are looked for in', presetFoldersDialog),
        item('strut_workspace_edit_actor', 'Strut Scenes: Edit Character...', 'manage_accounts', 'Change who a character is for the scene, or remove it', () => editActorDialog()),
        item('strut_workspace_add_clip', 'Strut Scenes: Add Clip...', 'movie', 'Add a clip to the scene, named and set as the kind of scene asks', () => addClipDialog()),
        item('strut_workspace_settings', 'Strut Scenes: Scene Settings...', 'settings', 'The kind of scene, its name and the namespace its files are written under', workspaceSettingsDialog),
        item('strut_workspace_animation_tags', 'Strut Scenes: Animation Tags...', 'label', 'The selected animation\'s phase, variant and side for the layout (filled in for you in a scene of a kind that names them), and each character\'s shift in time', animationTagsDialog),
        {
            action: new (Action as any)('strut_workspace_toggle_variables', {
                name: 'Strut Scenes: Show or Hide Variable Placeholders',
                icon: 'data_object',
                description: 'The Variable Placeholders panel is hidden in a scene, which has no use for it; this shows it or hides it again',
                category: 'view',
                condition: isStrutWorkspace,
                click: toggleVariablePlaceholders,
            }),
            menuCategory: 'view',
        },
        item('strut_workspace_check', 'Strut Scenes: Check the Scene', 'fact_check', 'Check the scene for what would stop an export or make it wrong', checkWorkspace),
        {
            action: new (Action as any)('strut_workspace_export', {
                name: 'Export Strut Scene...',
                icon: 'save',
                description: 'Export every character\'s clips into its clip set, and the scene\'s layout',
                category: 'file',
                condition: isStrutWorkspace,
                click: exportWorkspace,
            }),
            menuCategory: 'file.export',
        },
    ];
}
