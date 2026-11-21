import { decodeAnimation, encodeAnimation, RawBinaryAnimation } from '../../ts/binary/animation';
import { decodeModel, encodeModel, RawBinaryModel } from '../../ts/binary/model';
import { ANIMATION_FLAG_SKELETON_ID, decodeSkeletonId, encodeSkeletonId, isValidSkeletonId, SKELETON_SECTION } from '../../ts/binary/skeletonId';
import { convertAnimationFile } from '../../ts/convert/animationToRaw';
import { convertGeoFile } from '../../ts/convert/geoToRaw';

/**
 * The skeleton id written the way Strut's own tests ({@code SkeletonIdTest}) read it: a model section of a little endian length and UTF-8 text, and an animation header
 * flag with the id's string-table index in the first two reserved bytes (offset 20)
 */
describe('skeleton id', () => {
    const id = 'mymod:creature_a';

    function animation(skeletonId?: string): RawBinaryAnimation {
        return {
            version: 100,
            flags: 0,
            skeletonFingerprint: 1234,
            ...(skeletonId ? { skeletonId } : {}),
            strings: skeletonId ? ['walk', skeletonId] : ['walk'],
            clips: [{ name: 'walk', duration: 1, loop: 'LOOP', channels: [], events: [] }],
        };
    }

    test('the section payload is a little endian length and the UTF-8 id, and reads back', () => {
        const payload = encodeSkeletonId(id);

        expect(Array.from(payload.subarray(0, 2))).toEqual([id.length, 0]);
        expect(new TextDecoder().decode(payload.subarray(2))).toBe(id);
        expect(decodeSkeletonId(payload)).toBe(id);
    });

    test('an empty or cut short payload is no id', () => {
        expect(decodeSkeletonId(new Uint8Array(0))).toBeNull();
        expect(decodeSkeletonId(new Uint8Array([0, 0]))).toBeNull();
        expect(decodeSkeletonId(new Uint8Array([9, 0, 65]))).toBeNull();
    });

    test('what counts as an id', () => {
        expect(isValidSkeletonId('mymod:creature_a')).toBe(true);
        expect(isValidSkeletonId('my-mod:a/b.c')).toBe(true);
        expect(isValidSkeletonId('creature')).toBe(false);
        expect(isValidSkeletonId('My:Creature')).toBe(false);
        expect(isValidSkeletonId('')).toBe(false);
    });

    test('an animation with an id sets the flag, puts the string index at byte 20, and reads back', () => {
        const bytes = encodeAnimation(animation(id));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        expect(view.getUint16(6, true) & ANIMATION_FLAG_SKELETON_ID).toBe(ANIMATION_FLAG_SKELETON_ID);
        expect(view.getUint16(20, true)).toBe(1);
        expect(bytes.subarray(22, 32).every(b => b === 0)).toBe(true);

        const back = decodeAnimation(bytes, 'a.strutanim');

        expect(back.skeletonId).toBe(id);
        expect(encodeAnimation(back)).toEqual(bytes);
    });

    test('an animation without an id writes zeros there and no flag, as before', () => {
        const bytes = encodeAnimation(animation());
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        expect(view.getUint16(6, true)).toBe(0);
        expect(bytes.subarray(20, 32).every(b => b === 0)).toBe(true);
        expect(decodeAnimation(bytes, 'a.strutanim').skeletonId).toBeUndefined();
    });

    test('a file naming an id outside its string table is refused', () => {
        const bytes = encodeAnimation(animation(id));

        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(20, 9, true);

        expect(() => decodeAnimation(bytes, 'a.strutanim')).toThrow(/skeleton id/);
    });

    test('a model carries the id as its strut:skeleton extension, and reads it back', () => {
        const model: RawBinaryModel = {
            version: 101, modelId: null, unitsPerBlock: 16, boundsMin: [0, 0, 0], boundsMax: [0, 0, 0],
            extensions: new Map([[SKELETON_SECTION, encodeSkeletonId(id)]]),
            strings: [], textures: [], groupBones: [], meshes: [], cubes: [], armatures: [],
        };

        const back = decodeModel(encodeModel(model), 'a.strutmodel');

        expect(decodeSkeletonId(back.extensions!.get('strut:skeleton')!)).toBe(id);
    });

    test('the converters write the id they are given', () => {
        const converted = convertAnimationFile({ animations: { 'animation.x.walk': {} } }, { skeletonId: id });

        expect(converted.animation.skeletonId).toBe(id);
        expect(converted.animation.strings).toContain(id);
        expect(decodeAnimation(encodeAnimation(converted.animation), 'x').skeletonId).toBe(id);

        const geo = {
            'minecraft:geometry': [{ description: { identifier: 'geometry.x', texture_width: 16, texture_height: 16 }, bones: [{ name: 'root' }] }],
        };
        const model = convertGeoFile(geo, { skeletonId: id }).model;

        expect(decodeSkeletonId(model.extensions!.get(SKELETON_SECTION)!)).toBe(id);
        expect(convertGeoFile(geo).model.extensions).toBeUndefined();
    });
});
