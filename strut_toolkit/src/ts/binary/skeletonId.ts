/**
 * The skeleton id: a string naming the rig a model is built on (a scene checks that whoever fills a role is on the rig the role was made for), stored in a model and
 * in the animation files made for it. Mirrors {@code StrutBinaryFormats.SKELETON_SECTION}, {@code skeletonIdOfSection} and
 * {@code ANIMATION_FLAG_SKELETON_ID} on the Java side
 */

/** The model extension section that carries the id */
export const SKELETON_SECTION = 'strut:skeleton';

/** Animation header flag bit 0: the string-table index of the id is in the first two reserved header bytes (offset 20) */
export const ANIMATION_FLAG_SKELETON_ID = 1;

const SKELETON_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/** Whether {@code id} is a skeleton id: a namespace, a colon and a path, such as {@code mymod:creature_a} */
export function isValidSkeletonId(id: string): boolean {
    return SKELETON_ID_PATTERN.test(id);
}

/** The payload of the {@link SKELETON_SECTION}: the id as a little endian {@code u16} length and that many UTF-8 bytes */
export function encodeSkeletonId(id: string): Uint8Array {
    const text = new TextEncoder().encode(id);

    if (text.length > 0xFFFF)
        throw new Error(`a skeleton id of ${text.length} bytes does not fit the format`);

    const bytes = new Uint8Array(2 + text.length);

    bytes[0] = text.length & 0xFF;
    bytes[1] = text.length >>> 8;
    bytes.set(text, 2);

    return bytes;
}

/** The id in a {@link SKELETON_SECTION} payload, or null for an empty or cut-short one (read as no id, as the game does) */
export function decodeSkeletonId(payload: Uint8Array): string | null {
    if (payload.length < 2)
        return null;

    const length = payload[0] | (payload[1] << 8);

    if (length === 0 || payload.length < 2 + length)
        return null;

    return new TextDecoder().decode(payload.subarray(2, 2 + length));
}
