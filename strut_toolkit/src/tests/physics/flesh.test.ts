import * as fs from 'fs';
import * as path from 'path';
import { CENTRE, FleshCage, FleshGeometry, FleshRegion, fleshStep, NODES, resolveFlesh, STEP, SURFACE } from '../../ts/physics/flesh';

// The Java record (tests/fixtures/flesh.json, copied from the engine's src/test/resources/golden/flesh.json), written by its FleshGoldenTest from the Java FleshCage and FleshSolver
const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/flesh.json'), 'utf8'));
const SHOWN = [0, 40, 80, 120, 161, 162];

/** Points on a ball of radius {@code r} about {@code (cx, cy, cz)}, the way the Java record makes them */
function ball(cx: number, cy: number, cz: number, r: number, count: number): [number, number, number][] {
    const points: [number, number, number][] = [];
    const g = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
        const y = 1 - 2 * (i + 0.5) / count;
        const ring = Math.sqrt(1 - y * y);
        const a = g * i;

        points.push([cx + r * ring * Math.cos(a), cy + r * y, cz + r * ring * Math.sin(a)]);
    }

    return points;
}

function run(scenario: any): { worstLump: number; worstNode: number; worstRest: number; worstFinal: number } {
    const entry = JSON.parse(scenario.entry);
    const params = resolveFlesh(entry);
    const regions: FleshRegion[] = scenario.centres.map((cx: number) => new FleshRegion(new FleshCage(ball(cx, 1.3, -0.2, scenario.radius, scenario.count), params)));
    let worstLump = 0;
    let worstNode = 0;
    let worstRest = 0;

    regions.forEach((r, k) => {
        for (let i = 0; i < NODES * 3; i++) worstRest = Math.max(worstRest, Math.abs(r.cage.rest[i] - scenario.cageRest[k][i]));
    });

    golden.single.steps.forEach((_: unknown, s: number) => {
        const t = s * STEP;
        const x = 0.3 * Math.sin(5 * t);
        const y = 0.15 * Math.sin(7 * t + 1);
        const z = 0.2 * Math.sin(3 * t);
        const angle = 1.2 * Math.sin(2 * t);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        for (const r of regions) {
            for (let i = 0; i < NODES; i++) {
                const rx = r.cage.rest[i * 3];
                const ry = r.cage.rest[i * 3 + 1];
                const rz = r.cage.rest[i * 3 + 2];

                r.target[i * 3] = cos * rx + sin * rz + x;
                r.target[i * 3 + 1] = ry + y;
                r.target[i * 3 + 2] = -sin * rx + cos * rz + z;
            }

            r.tipDirection[0] = cos * r.cage.tip[0] + sin * r.cage.tip[2];
            r.tipDirection[1] = r.cage.tip[1];
            r.tipDirection[2] = -sin * r.cage.tip[0] + cos * r.cage.tip[2];
            r.up[0] = cos * r.cage.up[0] + sin * r.cage.up[2];
            r.up[1] = r.cage.up[1];
            r.up[2] = -sin * r.cage.up[0] + cos * r.cage.up[2];
            r.animatedHeight = r.target[CENTRE * 3 + 1];
            r.linksStale = true;
        }

        fleshStep(regions, params);

        regions.forEach((r, k) => {
            const expected = scenario.steps[s][k];

            for (let a = 0; a < 3; a++) worstLump = Math.max(worstLump, Math.abs(r.lump[a] - expected.lump[a]));

            SHOWN.forEach((n, j) => {
                for (let a = 0; a < 3; a++) worstNode = Math.max(worstNode, Math.abs(r.x[n * 3 + a] - expected.nodes[j][a]));
            });
        });
    });

    let worstFinal = 0;

    regions.forEach((r, k) => {
        for (let i = 0; i < NODES * 3; i++) worstFinal = Math.max(worstFinal, Math.abs(r.x[i] - scenario.final[k][i]));
    });

    return { worstLump, worstNode, worstRest, worstFinal };
}

describe('the TypeScript flesh agrees with the Java one', () => {
    test('the cage has the Java shape: 162 nodes on the sphere, 480 edges, outward triangles', () => {
        const g = FleshGeometry.get();

        expect(g.dir.length).toBe(SURFACE * 3);
        expect(g.faces.length).toBe(320 * 3);
        expect(g.linkA.length).toBe(480 + SURFACE);
        expect(Math.min(...g.neighbours.map(n => n.length))).toBe(5);
    });

    for (const name of ['single', 'pair', 'zone']) {
        test(`${name}: a cage fitted to a ball and carried through the scripted motion follows the Java swing and nodes step by step`, () => {
            const worst = run(golden[name]);

            // the same fit to the last digits, then the same dynamics: the Java runs in doubles too, so only the order of a few sums can differ
            expect(worst.worstRest).toBeLessThan(1e-9);
            expect(worst.worstLump).toBeLessThan(1e-7);
            expect(worst.worstNode).toBeLessThan(1e-7);
            expect(worst.worstFinal).toBeLessThan(1e-7);
        });
    }

    test('a mutation is seen: a different damping gives a different swing', () => {
        const scenario = JSON.parse(JSON.stringify(golden.single));

        scenario.entry = '{"bones": ["b"], "lump": {"damping": 0.5}}';

        expect(run(scenario).worstLump).toBeGreaterThan(1e-4);
    });
});

describe('the entry is read the way the game reads it', () => {
    test('the preset, grouped keys and meat give the game numbers', () => {
        const warnings: string[] = [];
        const p = resolveFlesh({ bones: ['b'], preset: 'seat', lump: { damping: 0.25 }, meat: 1 }, warnings);

        expect(warnings).toEqual([]);
        expect(p.firmness).toBeCloseTo(1.1547, 4);
        expect(p.lumpDamping).toBeCloseTo(0.25 * 1.8, 5);
        expect(p.nodeDamping).toBeCloseTo(0.3 * 1.8, 5);
        expect(p.gravity).toBeCloseTo(0.00272 * 1.5, 7);
    });

    test('old per-vertex keys and unknown ones are named', () => {
        const warnings: string[] = [];

        resolveFlesh({ bone: 'b', stiffness: 0.9, gravity: 0.1, wobble: 1, preset: 'nope' }, warnings, 'flesh "x"');

        expect(warnings.join('\n')).toContain('unknown soft preset "nope"');
        expect(warnings.join('\n')).toContain('stiffness');
        expect(warnings.join('\n')).toContain('unknown key "wobble"');
    });
});
