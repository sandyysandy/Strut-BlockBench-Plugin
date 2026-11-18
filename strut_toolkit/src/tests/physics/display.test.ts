import { cubeGrid } from '../../ts/physics/cubeMesh';
import { cubeDisplay, groupsByPlace, matchFace, smoothNormals } from '../../ts/physics/display';
import { V3 } from '../../ts/physics/math';

/** The scene's own geometry of a cube: four vertices a face, the faces in another order than the grid's, each face's corners in another order too */
function sceneCube(grid: ReturnType<typeof cubeGrid>): { positions: number[]; uvs: number[]; order: number[] } {
    const order = [3, 0, 5, 1, 4, 2];
    const positions: number[] = [];
    const uvs: number[] = [];

    order.forEach((side, face) => {
        const c = grid!.corners[side]!;

        // corners listed from the second one on, so the match has to look at where they are
        [1, 2, 3, 0].forEach((k, n) => {
            positions.push(...c[k]);
            uvs.push(face * 10 + n, face * 10 + n + 0.5);
        });
    });

    return { positions, uvs, order };
}

describe('a cube cut into a grid, drawn with its own texture', () => {
    const grid = cubeGrid([0, 0, 0], [4, 8, 4])!;
    const scene = sceneCube(grid);

    it('finds the face of the scene cube that lies on the corners of a grid face', () => {
        for (let side = 0; side < 6; side++) {
            expect(matchFace(grid.corners[side]!, scene.positions).face).toBe(scene.order.indexOf(side));
        }
    });

    it('takes the coordinates of the corners from the face they lie on, and blends between them', () => {
        const display = cubeDisplay(grid, scene.positions, scene.uvs, () => true);
        const corner = (side: number, st: [number, number]): number => grid.st.findIndex((p, i) => p[0] === st[0] && p[1] === st[1] && grid.sides[grid.faces.findIndex(f => f.includes(i))] === side);

        for (let side = 0; side < 6; side++) {
            const face = scene.order.indexOf(side);
            // the corner c0 of the grid face is the fourth vertex listed for the scene face
            const first = corner(side, [0, 0]);

            expect(display.uv[first * 2]).toBeCloseTo(face * 10 + 3, 5);
        }

        // the middle of a face is the mean of its four corners' coordinates
        const mid = grid.st.findIndex((p, i) => Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9 && grid.sides[grid.faces.findIndex(f => f.includes(i))] === 0);

        if (mid >= 0) expect(display.uv[mid * 2]).toBeCloseTo(scene.order.indexOf(0) * 10 + 1.5, 5);
    });

    it('draws only the faces that have a texture, a group for each, and every triangle inside its vertices', () => {
        const hidden = scene.order.indexOf(2);
        const display = cubeDisplay(grid, scene.positions, scene.uvs, face => face !== hidden);

        expect(display.groups.length).toBe(5);
        expect(display.groups.some(g => g.face === hidden)).toBe(false);
        expect(display.groups.reduce((s, g) => s + g.count, 0)).toBe(display.index.length);
        expect(display.index.every(i => i >= 0 && i < grid.local.length)).toBe(true);
    });
});

describe('smooth normals', () => {
    it('are shared by the vertices that are one point, and point out of a closed surface', () => {
        const grid = cubeGrid([-4, -4, -4], [4, 4, 4])!;
        const positions = grid.local.flatMap(v => v);
        const index = grid.faces.flatMap(f => [f[0], f[1], f[2], f[0], f[2], f[3]]);
        const normals = smoothNormals(positions, index, groupsByPlace(grid.local as V3[]));

        for (let v = 0; v < grid.local.length; v++) {
            const dot = normals[v * 3] * grid.local[v][0] + normals[v * 3 + 1] * grid.local[v][1] + normals[v * 3 + 2] * grid.local[v][2];

            expect(dot).toBeGreaterThan(0);
        }
    });
});
