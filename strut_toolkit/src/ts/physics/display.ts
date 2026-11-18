/**
 * What the preview needs to draw flesh and cloth with the model's own texture: the texture coordinates of a cube cut into a grid (taken from the cube's own
 * faces in the scene, so a mirrored or turned texture stays as it was), the triangles and material groups for it, and smooth normals for a surface whose
 * texture seams repeat its vertices. No Blockbench globals
 */
import { CubeGrid } from './cubeMesh';
import { V3 } from './math';

/** What a cube cut into a grid is drawn with */
export interface CubeDisplay {
    /** Texture coordinates, two per grid vertex */
    uv: Float32Array;
    /** Triangles over the grid's vertices */
    index: number[];
    /** Runs of the index, one per face of the cube that has a texture; {@code face} is the cube's own face (0 to 5, in the scene's order) the run is textured by */
    groups: { start: number; count: number; face: number }[];
}

/**
 * The face of the scene's cube (four vertices each, {@code positions} three numbers a vertex) that lies on the four corners, and for each corner the vertex of that
 * face it is: the face with the least total distance to them
 */
export function matchFace(corners: readonly V3[], positions: ArrayLike<number>): { face: number; verts: number[] } {
    const faces = Math.floor(positions.length / 12);
    let best = { face: 0, verts: [0, 1, 2, 3], cost: Infinity };

    for (let face = 0; face < faces; face++) {
        const verts: number[] = [];
        let cost = 0;

        for (const corner of corners) {
            let nearest = face * 4;
            let distance = Infinity;

            for (let k = 0; k < 4; k++) {
                const v = face * 4 + k;
                const d = (positions[v * 3] - corner[0]) ** 2 + (positions[v * 3 + 1] - corner[1]) ** 2 + (positions[v * 3 + 2] - corner[2]) ** 2;

                if (d < distance) {
                    distance = d;
                    nearest = v;
                }
            }

            verts.push(nearest);
            cost += distance;
        }

        if (cost < best.cost) best = { face, verts, cost };
    }

    return { face: best.face, verts: best.verts };
}

/**
 * The texture coordinates, triangles and material groups of a cube's grid. {@code positions} and {@code uvs} are the scene's own geometry of the cube, in its
 * own space (relative to the cube's origin); {@code shown(face)} says whether that face of the cube has a texture (a face without one is not drawn)
 */
export function cubeDisplay(grid: CubeGrid, positions: ArrayLike<number>, uvs: ArrayLike<number>, shown: (face: number) => boolean): CubeDisplay {
    const uv = new Float32Array(grid.local.length * 2);
    const index: number[] = [];
    const groups: { start: number; count: number; face: number }[] = [];
    const faceOfSide: number[] = [];
    const vertsOfSide: number[][] = [];

    grid.corners.forEach((corners, side) => {
        if (!corners) return;

        const match = matchFace(corners, positions);

        faceOfSide[side] = match.face;
        vertsOfSide[side] = match.verts;
    });

    // each vertex belongs to one face: the one whose quads use it
    const sideOfVertex = new Array<number>(grid.local.length).fill(-1);

    grid.faces.forEach((quad, q) => quad.forEach(v => { sideOfVertex[v] = grid.sides[q]; }));

    grid.local.forEach((_, i) => {
        const side = sideOfVertex[i];
        const verts = vertsOfSide[side];

        if (side < 0 || !verts) return;

        const [s, t] = grid.st[i];
        const w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];

        for (let a = 0; a < 2; a++) {
            let value = 0;

            for (let k = 0; k < 4; k++) value += w[k] * uvs[verts[k] * 2 + a];

            uv[i * 2 + a] = value;
        }
    });

    let current = -1;

    grid.faces.forEach((quad, q) => {
        const side = grid.sides[q];
        const face = faceOfSide[side];

        if (face === undefined || !shown(face)) return;

        if (side !== current) {
            groups.push({ start: index.length, count: 0, face });
            current = side;
        }

        index.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
        groups[groups.length - 1].count += 6;
    });

    return { uv, index, groups };
}

/**
 * Normals for the triangles, smoothed over the vertices that are one point of the surface ({@code groupOf}: the same number for vertices that coincide, as they
 * do where a texture seam repeats a vertex): the area-weighted mean of the faces around each point
 */
export function smoothNormals(positions: ArrayLike<number>, index: ArrayLike<number>, groupOf: ArrayLike<number>): Float32Array {
    const out = new Float32Array(positions.length);
    const sums = new Map<number, [number, number, number]>();

    for (let i = 0; i + 2 < index.length; i += 3) {
        const a = index[i];
        const b = index[i + 1];
        const c = index[i + 2];
        const ux = positions[b * 3] - positions[a * 3];
        const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
        const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
        const vx = positions[c * 3] - positions[a * 3];
        const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
        const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
        const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];

        for (const vertex of [a, b, c]) {
            const key = groupOf[vertex];
            const sum = sums.get(key) ?? [0, 0, 0];

            sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2];
            sums.set(key, sum);
        }
    }

    for (let v = 0; v < positions.length / 3; v++) {
        const sum = sums.get(groupOf[v]);

        if (!sum) continue;

        const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;

        out[v * 3] = sum[0] / length;
        out[v * 3 + 1] = sum[1] / length;
        out[v * 3 + 2] = sum[2] / length;
    }

    return out;
}

/** The same number for the vertices at the same place: what {@link smoothNormals} groups by */
export function groupsByPlace(points: readonly V3[]): number[] {
    const seen = new Map<string, number>();

    return points.map(p => {
        const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
        const id = seen.get(key);

        if (id !== undefined) return id;

        seen.set(key, seen.size);

        return seen.size - 1;
    });
}
