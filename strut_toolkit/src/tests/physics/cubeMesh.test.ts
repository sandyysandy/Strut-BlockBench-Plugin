import { weld } from '../../ts/physics/cloth';
import { cubeGrid, cubeRest, MOST } from '../../ts/physics/cubeMesh';
import { V3 } from '../../ts/physics/math';
import { ClothMeshInput, PhysicsRig } from '../../ts/physics/rig';

const BONES = [{ name: 'root', parent: null }, { name: 'tuft', parent: 'root' }];
const noAuto = (): never[] => [];

describe('a cube as a grid of vertices', () => {
    it('cuts each face of a 4 unit cube into a grid and keeps the cube\'s corners', () => {
        const grid = cubeGrid([-2, 0, -2], [2, 4, 2])!;
        const lo = [0, 1, 2].map(a => Math.min(...grid.local.map(v => v[a])));
        const hi = [0, 1, 2].map(a => Math.max(...grid.local.map(v => v[a])));

        [-2, 0, -2].forEach((v, a) => expect(lo[a]).toBeCloseTo(v, 9));
        [2, 4, 2].forEach((v, a) => expect(hi[a]).toBeCloseTo(v, 9));
        expect(grid.faces.length).toBe(6 * 3 * 3);
        expect(grid.faces.every(f => f.length === 4 && f.every(i => i >= 0 && i < grid.local.length))).toBe(true);
    });

    it('welds into one closed surface: the corners shared by faces are one particle', () => {
        const grid = cubeGrid([0, 0, 0], [4, 4, 4])!;
        const welded = weld(grid.local.map((v): V3 => [v[0] / 16, v[1] / 16, v[2] / 16]), grid.faces);

        // a 3 x 3 grid on each face of a cube: 8 corners, 12 edges of 2 inner points, 6 faces of 4 inner points
        expect(welded.rest.length).toBe(8 + 12 * 2 + 6 * 4);
    });

    it('cuts a large cube into at most MOST along an edge', () => {
        expect(cubeGrid([0, 0, 0], [40, 40, 40])!.faces.length).toBe(6 * MOST * MOST);
    });

    it('makes a plane one grid, and nothing of a cube with no extent', () => {
        const plane = cubeGrid([0, 0, 0], [1, 0, 1])!;

        expect(plane.faces.length).toBe(1);
        expect(plane.local.every(v => v[1] === 0)).toBe(true);
        expect(cubeGrid([0, 0, 0], [4, 0, 0])).toBeNull();
    });

    it('puts the grid in the bone\'s space: turned about the origin, then moved to it, in blocks', () => {
        const rest = cubeRest([[1, 0, 0]], [16, 0, 0], [0, 0, 90]);

        // a quarter turn about z takes +x to +y
        expect(rest[0][0]).toBeCloseTo(1, 6);
        expect(rest[0][1]).toBeCloseTo(1 / 16, 6);
        expect(rest[0][2]).toBeCloseTo(0, 6);
    });
});

describe('flesh on a bone of cubes', () => {
    const grid = cubeGrid([-3, 8, -3], [3, 14, 3])!;
    const input: ClothMeshInput = { key: 'cube', bone: 'tuft', rest: cubeRest(grid.local, [0, 0, 0], [0, 0, 0]), faces: grid.faces, cube: true };

    it('makes a region from the cubes', () => {
        const rig = new PhysicsRig(BONES, { flesh: { tuft: { bone: 'tuft' } } }, noAuto, [input]);

        expect(rig.clothKeys()).toContain('cube');
        expect(rig.problems.filter(p => /no mesh/.test(p))).toEqual([]);
    });

    it('is not made into cloth', () => {
        const rig = new PhysicsRig(BONES, { cloth: { tuft: { bone: 'tuft' } } }, noAuto, [input]);

        expect(rig.clothKeys()).not.toContain('cube');
        expect(rig.problems.some(p => /no mesh/.test(p))).toBe(true);
    });
});
