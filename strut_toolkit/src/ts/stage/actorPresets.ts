/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Actor presets: ready-made actors for the workspace. A preset is a character's model, its texture and who it is in a scene (its role and skeleton id), so that adding it is
 * one choice instead of picking a model, then images, then typing an id.
 * <p>
 * Presets live in folders. A folder has a {@code presets.json} that lists them, and the files it names, with paths relative to the folder:
 * <pre>
 * { "version": 1, "name": "My Mod",
 *   "presets": [ { "id": "momo", "name": "Momo", "group": "Girls", "role": "host", "skeleton": "mymod:humanoid",
 *                  "model": "models/momo.strutmodel", "textures": ["textures/momo.png"], "compatible": [], "camera": "" } ] }
 * </pre>
 * Which folders are looked in is kept in the browser storage of Blockbench ({@code strut_actor_preset_folders}, a JSON list of folder paths), so a tool that makes presets (a
 * pack editor) can register its folder by writing that one key, and a person can add a folder from the Actors panel
 */

export const PRESET_FOLDERS_KEY = 'strut_actor_preset_folders';
export const PRESET_INDEX = 'presets.json';

export interface ActorPreset {
    /** Unique inside its folder */
    readonly id: string;
    readonly name: string;
    /** The heading it is listed under (`Girls`, `Male`) */
    readonly group: string;
    /** The role the actor is added as, which the person may change */
    readonly role: string;
    readonly skeleton: string;
    readonly compatible: readonly string[];
    readonly camera: string;
    /** Absolute paths, with {@code /} */
    readonly model: string;
    readonly textures: readonly string[];
    /** The folder's own name, for telling folders apart */
    readonly source: string;
}

export interface PresetIndex {
    readonly presets: readonly ActorPreset[];
    /** What was wrong with entries that were left out */
    readonly problems: readonly string[];
}

const SKELETON_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const ROLE = /^[a-z0-9_./-]+$/;

/** Joins a folder and a relative path with {@code /}, refusing paths that climb out of the folder */
export function inside(folder: string, relative: string): string | null {
    const parts = relative.split('\\').join('/').split('/');

    if (relative === '' || relative.startsWith('/') || /^[a-zA-Z]:/.test(relative) || parts.includes('..'))
        return null;

    return `${folder.split('\\').join('/').replace(/\/+$/, '')}/${parts.filter(part => part !== '' && part !== '.').join('/')}`;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** Reads a folder's {@code presets.json}; entries that are not usable are left out and reported */
export function parsePresetIndex(json: string, folder: string): PresetIndex {
    const problems: string[] = [];
    let root: any;

    try {
        root = JSON.parse(json);
    }
    catch {
        return { presets: [], problems: [`${folder}: ${PRESET_INDEX} is not valid JSON`] };
    }

    const source = text(root?.name) || folder.split('\\').join('/').split('/').filter(part => part !== '').pop() || folder;
    const presets: ActorPreset[] = [];
    const seen = new Set<string>();

    for (const entry of Array.isArray(root?.presets) ? root.presets : []) {
        const id = text(entry?.id);
        const label = id || '(no id)';

        if (id === '' || seen.has(id)) {
            problems.push(`${source}: ${label} has no id, or the id is used twice`);
            continue;
        }

        const model = inside(folder, text(entry.model));
        const skeleton = text(entry.skeleton);
        const role = text(entry.role) || 'actor';

        if (!model) {
            problems.push(`${source}: ${id} has no model inside the folder`);
            continue;
        }

        if (!SKELETON_ID.test(skeleton)) {
            problems.push(`${source}: ${id} has no valid skeleton ID`);
            continue;
        }

        if (!ROLE.test(role)) {
            problems.push(`${source}: ${id} has a role that is not a role name`);
            continue;
        }

        seen.add(id);
        presets.push({
            id,
            name: text(entry.name) || id,
            group: text(entry.group) || source,
            role,
            skeleton,
            compatible: (Array.isArray(entry.compatible) ? entry.compatible : []).map(text).filter(each => SKELETON_ID.test(each)),
            camera: text(entry.camera),
            model,
            textures: (Array.isArray(entry.textures) ? entry.textures : []).map((each: unknown) => inside(folder, text(each))).filter((each: string | null): each is string => each !== null),
            source,
        });
    }

    return { presets, problems };
}

/** The registered folders, from a storage that may be missing or hold anything */
export function readFolders(storage: Pick<Storage, 'getItem'> | null): string[] {
    try {
        const value = JSON.parse(storage?.getItem(PRESET_FOLDERS_KEY) ?? '[]');

        return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string' && each !== '') : [];
    }
    catch {
        return [];
    }
}

export function writeFolders(storage: Pick<Storage, 'setItem'> | null, folders: readonly string[]): void {
    try {
        storage?.setItem(PRESET_FOLDERS_KEY, JSON.stringify([...new Set(folders.map(folder => folder.split('\\').join('/')))]));
    }
    catch {
        // no storage: the folders are not kept
    }
}

/** A role that is not taken: {@code wanted}, or {@code wanted_2}, {@code wanted_3}... */
export function freeRole(wanted: string, taken: ReadonlySet<string>): string {
    if (!taken.has(wanted))
        return wanted;

    let number = 2;

    while (taken.has(`${wanted}_${number}`))
        number++;

    return `${wanted}_${number}`;
}

// ===============================================================
// Reading the files (Blockbench)
// ===============================================================

type ReadType = 'text' | 'binary' | 'image';

/** One file read through Blockbench's own reader, or null if it could not be read */
export function readFile(path: string, type: ReadType): Promise<{ name: string; content: any } | null> {
    return new Promise(resolve => {
        const reader = (globalThis as any).Filesystem?.readFile ?? (globalThis as any).Blockbench?.read;

        if (typeof reader !== 'function') {
            resolve(null);

            return;
        }

        try {
            const owner = (globalThis as any).Filesystem?.readFile ? (globalThis as any).Filesystem : (globalThis as any).Blockbench;

            reader.call(owner, [path], { readtype: type }, (files: any[]) => resolve(files && files[0] ? { name: String(files[0].name ?? path), content: files[0].content } : null));
        }
        catch {
            resolve(null);
        }
    });
}

/** Every preset of every registered folder, and what was wrong with the folders and entries that could not be used */
export async function loadPresets(folders: readonly string[]): Promise<{ presets: ActorPreset[]; problems: string[] }> {
    const presets: ActorPreset[] = [];
    const problems: string[] = [];

    for (const folder of folders) {
        const file = await readFile(`${folder}/${PRESET_INDEX}`, 'text');

        if (!file || typeof file.content !== 'string') {
            problems.push(`${folder}: no ${PRESET_INDEX} could be read there`);
            continue;
        }

        const index = parsePresetIndex(file.content, folder);

        presets.push(...index.presets);
        problems.push(...index.problems);
    }

    return { presets, problems };
}
