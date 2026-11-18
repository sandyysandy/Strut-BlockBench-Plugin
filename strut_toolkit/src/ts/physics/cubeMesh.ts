/**
 * A cube as a grid of vertices, the twin of the game's CubeMeshes: flesh moves meshes, so a bone of cubes is given meshes made from them, each face cut into
 * a grid of quads about a model unit and a quarter across (at most six along an edge). The grid is in the cube's own space, relative to its origin and unrotated,
 * which is the space of its vertices in the scene; cubeRest turns it into the bone's space the way the cube is turned
 */
import { V3 } from './math';

/** About how wide one quad of a cut face is, in model units */
export const CELL = 1.25;

/** The most quads along one edge of a face */
export const MOST = 6;

export interface CubeGrid {
    /** The grid's vertices, model units, relative to the cube's origin, unrotated */
    readonly local: V3[];
    readonly faces: number[][];
    /** The face of the cube each quad is on, 0 to 5 in the order the faces are cut (-x, +x, -z, +z, +y, -y) */
    readonly sides: number[];
    /** Each vertex's place on its face, 0 to 1 across and 0 to 1 down: what a texture is laid out by */
    readonly st: [number, number][];
    /** The four corners of each of the six faces, in the order the grid is cut from them, or null for a face a plane does not have */
    readonly corners: (V3[] | null)[];
}

function sub3(a: V3, b: V3): V3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function cuts(a: V3, b: V3): number {
    const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    return Math.max(1, Math.min(MOST, Math.round(length / CELL)));
}

/**
 * The cube between from and to (model units, relative to its origin), each face cut into a grid. A flat cube (a plane: the game keeps both of its faces, one for
 * each side) is one grid here, drawn from both sides; null for a cube with no extent at all
 */
export function cubeGrid(from: V3, to: V3): CubeGrid | null {
    const flatAxes = [0, 1, 2].filter(a => from[a] === to[a]).length;

    if (flatAxes > 1) return null;

    const [x0, y0, z0] = from;
    const [x1, y1, z1] = to;
    const faces: V3[][] = [
        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
        [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
        [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
        [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
    ];
    const local: V3[] = [];
    const out: number[][] = [];
    const sides: number[] = [];
    const st: [number, number][] = [];
    const corners: (V3[] | null)[] = faces.map(() => null);

    let haveFlat = false;

    for (let side = 0; side < faces.length; side++) {
        const c = faces[side];

        if (flatAxes === 1) {
            const area = Math.hypot(...cross(sub3(c[2], c[0]), sub3(c[3], c[1])));

            // the edges of a plane have no area, and its two faces lie on each other
            if (area < 1e-9 || haveFlat) continue;

            haveFlat = true;
        }

        corners[side] = c;

        const across = cuts(c[0], c[1]);
        const down = cuts(c[0], c[3]);
        const base = local.length;
        const at = (i: number, j: number): number => base + j * (across + 1) + i;

        for (let j = 0; j <= down; j++) {
            for (let i = 0; i <= across; i++) {
                const s = i / across;
                const t = j / down;
                const w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];

                local.push([0, 1, 2].map(a => w[0] * c[0][a] + w[1] * c[1][a] + w[2] * c[2][a] + w[3] * c[3][a]) as V3);
                st.push([s, t]);
            }
        }

        for (let j = 0; j < down; j++) {
            for (let i = 0; i < across; i++) {
                out.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
                sides.push(side);
            }
        }
    }

    return { local, faces: out, sides, st, corners };
}

/** The grid's vertices in the bone's space, blocks: turned by the cube's rotation (degrees, about its origin, Z then Y then X) and moved to its origin */
export function cubeRest(local: readonly V3[], origin: V3, rotation: V3, unit = 16): V3[] {
    const [rx, ry, rz] = rotation.map(d => d * Math.PI / 180);
    const [sx, cx] = [Math.sin(rx), Math.cos(rx)];
    const [sy, cy] = [Math.sin(ry), Math.cos(ry)];
    const [sz, cz] = [Math.sin(rz), Math.cos(rz)];

    return local.map(([x, y, z]): V3 => {
        // the matrix of three.js's 'ZYX' Euler: Rz * Ry * Rx
        const px = cz * cy * x + (cz * sy * sx - sz * cx) * y + (cz * sy * cx + sz * sx) * z;
        const py = sz * cy * x + (sz * sy * sx + cz * cx) * y + (sz * sy * cx - cz * sx) * z;
        const pz = -sy * x + cy * sx * y + cy * cx * z;

        return [(px + origin[0]) / unit, (py + origin[1]) / unit, (pz + origin[2]) / unit];
    });
}
