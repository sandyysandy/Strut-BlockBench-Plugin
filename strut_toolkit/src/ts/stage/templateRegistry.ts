/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseTemplateList, parseTemplates, SceneTemplate } from './sceneTemplate';
import { PRESET_FOLDERS_KEY, readFile, readFolders, writeFolders } from './actorPresets';

/**
 * The scene templates Strut Scenes knows, and the API other plugins and tools use to add their own
 * <p>
 * Where templates come from, each with a source name so they can be taken away again:
 * <ul>
 * <li>the ones built in ({@code strut}): a free scene, and clips for one skeleton;</li>
 * <li>a plugin, in code: {@code StrutScenes.registerTemplate(...)} (see {@link installApi});</li>
 * <li>a folder with a {@code templates.json}, registered in the browser storage of Blockbench under {@link TEMPLATE_FOLDERS_KEY} (a JSON list of folder paths), so a
 * tool that is not a Blockbench plugin (a pack editor) can add its templates by writing that one key; the folders are read when a scene is started or the list is
 * refreshed. The actor preset folders ({@link PRESET_FOLDERS_KEY}) work the same way.</li>
 * </ul>
 */

export const TEMPLATE_FOLDERS_KEY = 'strut_scene_template_folders';
export const TEMPLATE_INDEX = 'templates.json';
export const API_VERSION = 1;

export const BUILT_IN: readonly SceneTemplate[] = parseTemplateList([
    {
        id: 'strut:free', name: 'Free scene', group: 'Strut',
        description: 'Characters that play clips together, with no rules about what the clips are called or how many there are.',
        roles: [
            { id: 'actor_1', name: 'Actor 1', lead: true },
            { id: 'actor_2', name: 'Actor 2', required: false },
            { id: 'actor_3', name: 'Actor 3', required: false },
        ],
        clips: { naming: 'animation.{scene}.{phase}', freeClips: true },
    },
    {
        id: 'strut:skeleton_clips', name: 'Clips for one skeleton', group: 'Strut',
        description: 'One character animated for its skeleton, so every model with that skeleton can play the clips (a walk, an idle, a gesture).',
        roles: [{ id: 'actor', name: 'Character', lead: true }],
        clips: { naming: 'animation.{scene}.{phase}', freeClips: true },
    },
], 'strut').templates;

export interface RegisteredTemplate {
    readonly template: SceneTemplate;
    /** Who added it: {@code strut}, {@code api:<name>} or a folder's path */
    readonly source: string;
}

type Listener = () => void;

export class TemplateRegistry {
    private readonly bySource = new Map<string, SceneTemplate[]>();
    private readonly listeners = new Set<Listener>();
    /** What was wrong with what was registered, for showing */
    readonly problems: string[] = [];

    constructor() {
        this.bySource.set('strut', [...BUILT_IN]);
    }

    /** Sets everything {@code source} registered to {@code templates} (a source registering again replaces what it had) */
    set(source: string, templates: readonly SceneTemplate[]): void {
        this.bySource.set(source, [...templates]);
        this.changed();
    }

    remove(source: string): void {
        if (this.bySource.delete(source))
            this.changed();
    }

    /** Every template, built in first; a template id that two sources have is listed once, from the first source */
    list(): RegisteredTemplate[] {
        const seen = new Set<string>();
        const found: RegisteredTemplate[] = [];

        for (const [source, templates] of this.bySource) {
            for (const template of templates) {
                if (!seen.has(template.id)) {
                    seen.add(template.id);
                    found.push({ template, source });
                }
            }
        }

        return found;
    }

    get(id: string): SceneTemplate | undefined {
        return this.list().find(entry => entry.template.id === id)?.template;
    }

    onChange(listener: Listener): () => void {
        this.listeners.add(listener);

        return () => void this.listeners.delete(listener);
    }

    private changed(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch (error) {
                console.warn('[Strut Scenes] a template listener threw', error);
            }
        }
    }

    /** Reads the folders registered in {@code storage}, replacing what the folders gave before */
    async refreshFolders(storage: Pick<Storage, 'getItem'> | null): Promise<void> {
        const folders = readList(storage, TEMPLATE_FOLDERS_KEY);

        for (const source of [...this.bySource.keys()]) {
            if (source.startsWith('folder:') && !folders.includes(source.slice('folder:'.length)))
                this.bySource.delete(source);
        }

        this.problems.length = 0;

        for (const folder of folders) {
            const file = await readFile(`${folder}/${TEMPLATE_INDEX}`, 'text');

            if (!file || typeof file.content !== 'string') {
                this.problems.push(`${folder}: no ${TEMPLATE_INDEX} could be read there`);
                continue;
            }

            const parsed = parseTemplates(file.content, folder);

            this.problems.push(...parsed.problems);
            this.bySource.set(`folder:${folder}`, [...parsed.templates]);
        }

        this.changed();
    }
}

/** A list of strings kept under {@code key}, from a storage that may be missing or hold anything */
export function readList(storage: Pick<Storage, 'getItem'> | null, key: string): string[] {
    try {
        const value = JSON.parse(storage?.getItem(key) ?? '[]');

        return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string' && each !== '') : [];
    }
    catch {
        return [];
    }
}

export const registry = new TemplateRegistry();

// ===============================================================
// The API
// ===============================================================

/**
 * What {@code globalThis.StrutScenes} is for another Blockbench plugin. Everything takes and returns plain data
 * <pre>
 * StrutScenes.apiVersion                         1
 * StrutScenes.registerTemplate(template | [..], source?)   adds templates (the shape of sceneTemplate.ts); returns { ok, problems }
 * StrutScenes.unregisterTemplates(source)        takes away what a source added
 * StrutScenes.templates()                        [{ id, name, group, source }]
 * StrutScenes.registerPresetFolder(path)         a folder with a presets.json of ready-made actors
 * StrutScenes.registerTemplateFolder(path)       a folder with a templates.json
 * StrutScenes.onTemplatesChanged(callback)       returns a function that stops listening
 * </pre>
 */
export interface StrutScenesApi {
    readonly apiVersion: number;
    registerTemplate(template: unknown, source?: string): { ok: boolean; problems: string[] };
    unregisterTemplates(source: string): void;
    templates(): { id: string; name: string; group: string; source: string }[];
    registerPresetFolder(path: string): void;
    registerTemplateFolder(path: string): Promise<void>;
    onTemplatesChanged(callback: () => void): () => void;
}

function storage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    }
    catch {
        return null;
    }
}

export function createApi(target: TemplateRegistry = registry): StrutScenesApi {
    return {
        apiVersion: API_VERSION,
        registerTemplate(template, source = 'api') {
            const parsed = parseTemplateList(Array.isArray(template) ? template : [template], `api:${source}`);

            if (parsed.templates.length > 0) {
                const name = `api:${source}`;
                const existing = target.list().filter(entry => entry.source === name).map(entry => entry.template);
                const ids = new Set(parsed.templates.map(each => each.id));

                target.set(name, [...existing.filter(each => !ids.has(each.id)), ...parsed.templates]);
            }

            return { ok: parsed.problems.length === 0 && parsed.templates.length > 0, problems: [...parsed.problems] };
        },
        unregisterTemplates(source) {
            target.remove(`api:${source}`);
        },
        templates() {
            return target.list().map(entry => ({ id: entry.template.id, name: entry.template.name, group: entry.template.group, source: entry.source }));
        },
        registerPresetFolder(path) {
            const folders = readFolders(storage());

            writeFolders(storage(), [...folders, path]);
        },
        async registerTemplateFolder(path) {
            const store = storage();

            try {
                const folders = readList(store, TEMPLATE_FOLDERS_KEY);

                store?.setItem(TEMPLATE_FOLDERS_KEY, JSON.stringify([...new Set([...folders, path.split('\\').join('/')])]));
            }
            catch {
                // no storage: the folder is not kept
            }

            await target.refreshFolders(store);
        },
        onTemplatesChanged(callback) {
            return target.onChange(callback);
        },
    };
}

export function installApi(): void {
    (globalThis as any).StrutScenes = createApi();
}

export function uninstallApi(): void {
    delete (globalThis as any).StrutScenes;
}

export { PRESET_FOLDERS_KEY };
