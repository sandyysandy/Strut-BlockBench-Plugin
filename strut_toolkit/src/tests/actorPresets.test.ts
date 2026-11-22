import { freeRole, inside, parsePresetIndex, PRESET_FOLDERS_KEY, readFolders, writeFolders } from '../ts/stage/actorPresets';

const index = (presets: unknown[], name = 'My Mod'): string => JSON.stringify({ version: 1, name, presets });

describe('actor presets', () => {
    test('a preset is read with its files made absolute, inside its folder', () => {
        const found = parsePresetIndex(index([
            { id: 'ava', name: 'Ava', group: 'Characters', role: 'host', skeleton: 'mymod:humanoid', model: 'models/ava.strutmodel', textures: ['textures/ava.png'], compatible: ['mymod:other', 'not an id'], camera: 'eye' },
        ]), 'C:\\presets\\mod');

        expect(found.problems).toEqual([]);
        expect(found.presets).toHaveLength(1);
        expect(found.presets[0]).toMatchObject({
            id: 'ava', name: 'Ava', group: 'Characters', role: 'host', skeleton: 'mymod:humanoid', camera: 'eye', source: 'My Mod',
            model: 'C:/presets/mod/models/ava.strutmodel', textures: ['C:/presets/mod/textures/ava.png'], compatible: ['mymod:other'],
        });
    });

    test('what is missing gets a default, and what cannot be used is left out with the reason', () => {
        const found = parsePresetIndex(index([
            { id: 'a', skeleton: 'mymod:x', model: 'a.strutmodel' },
            { id: 'a', skeleton: 'mymod:x', model: 'b.strutmodel' },
            { id: 'b', skeleton: 'no colon', model: 'b.strutmodel' },
            { id: 'c', skeleton: 'mymod:x', model: '../escape.strutmodel' },
            { id: 'd', skeleton: 'mymod:x', model: 'd.strutmodel', role: 'Bad Role' },
            { skeleton: 'mymod:x', model: 'e.strutmodel' },
        ]), '/p');

        expect(found.presets.map(preset => preset.id)).toEqual(['a']);
        expect(found.presets[0]).toMatchObject({ name: 'a', group: 'My Mod', role: 'actor', textures: [] });
        expect(found.problems).toHaveLength(5);
    });

    test('a file that is not JSON gives no presets and says so', () => {
        const found = parsePresetIndex('{not json', '/p');

        expect(found.presets).toEqual([]);
        expect(found.problems[0]).toContain('not valid JSON');
    });

    test('paths cannot climb out of the folder or name another drive', () => {
        expect(inside('/p/', 'a/b.png')).toBe('/p/a/b.png');
        expect(inside('/p', '../x')).toBeNull();
        expect(inside('/p', 'a/../../x')).toBeNull();
        expect(inside('/p', '/etc/x')).toBeNull();
        expect(inside('/p', 'C:/x')).toBeNull();
        expect(inside('/p', '')).toBeNull();
    });

    test('the registered folders are read and written without trusting the storage', () => {
        const data = new Map<string, string>();
        const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };

        expect(readFolders(store)).toEqual([]);
        expect(readFolders(null)).toEqual([]);

        writeFolders(store, ['C:\\a', 'C:/a', '/b']);
        expect(JSON.parse(data.get(PRESET_FOLDERS_KEY) ?? '[]')).toEqual(['C:/a', '/b']);

        data.set(PRESET_FOLDERS_KEY, '{"not": "a list"}');
        expect(readFolders(store)).toEqual([]);

        data.set(PRESET_FOLDERS_KEY, '["ok", 3, ""]');
        expect(readFolders(store)).toEqual(['ok']);
    });

    test('a role that is taken is numbered', () => {
        expect(freeRole('host', new Set())).toBe('host');
        expect(freeRole('host', new Set(['host']))).toBe('host_2');
        expect(freeRole('host', new Set(['host', 'host_2']))).toBe('host_3');
    });
});
