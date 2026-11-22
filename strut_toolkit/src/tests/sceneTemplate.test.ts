import { RawChannel } from '../ts/binary/animation';
import { checkAgainstTemplate, clipName, identify, parseTemplates, phaseStatus, SceneTemplate } from '../ts/stage/sceneTemplate';
import { BUILT_IN, createApi, TemplateRegistry } from '../ts/stage/templateRegistry';
import { newStage, Stage, StageActor, StageAnimation } from '../ts/stage/stageFormat';

const DOC = JSON.stringify({
    version: 1,
    templates: [{
        id: 'demo:duet', name: 'A duet', group: 'Demo', description: 'Two on a stage',
        roles: [
            { id: 'lead', name: 'Lead', skeleton: 'demo:human', lead: true, presetGroup: 'People' },
            { id: 'second', name: 'Second', required: false, compatible: ['demo:robot'] },
        ],
        clips: {
            naming: 'animation.{scene}.{phase}',
            phases: [
                { id: 'intro', name: 'Intro', loop: 'loop', required: true, seconds: { min: 1, max: 10 } },
                { id: 'slow', name: 'Slow', loop: 'loop', variants: { min: 1, max: 3 }, sides: ['L', 'R'] },
                { id: 'end', name: 'End', loop: 'once' },
            ],
        },
        rules: { keyedRoles: ['lead'] },
    }],
});

function template(): SceneTemplate {
    return parseTemplates(DOC, 'test').templates[0];
}

const keyed: RawChannel[] = [{ target: 'root', targetKind: 'GROUP_BONE', property: 'ROTATION', interpolation: 'LINEAR', keys: [] }];
const actor = (role: string, skeleton: string): StageActor => ({ role, skeleton, roots: [{ bone: 'root', pivot: [0, 0, 0] }], offset: { position: [0, 0, 0], yaw: 0 } });
const clip = (name: string, duration: number, loop: StageAnimation['loop'], roles: string[] = ['lead']): StageAnimation => ({
    name, duration, loop, tracks: Object.fromEntries(roles.map(role => [role, { channels: keyed, events: [] }])),
});

describe('reading templates', () => {
    test('a template is read with its roles, phases and rules', () => {
        const t = template();

        expect(t.id).toBe('demo:duet');
        expect(t.roles.map(role => [role.id, role.required, role.lead, role.skeleton])).toEqual([['lead', true, true, 'demo:human'], ['second', false, false, '']]);
        expect(t.roles[1].compatible).toEqual(['demo:robot']);
        expect(t.phases.map(phase => [phase.id, phase.loop, phase.required, phase.sides.length])).toEqual([['intro', 'loop', true, 0], ['slow', 'loop', true, 2], ['end', 'once', false, 0]]);
        expect(t.keyedRoles).toEqual(['lead']);
        expect(t.freeClips).toBe(false);
    });

    test('what cannot be used is left out and said, and a template with no phases is a free one', () => {
        const parsed = parseTemplates(JSON.stringify({ templates: [
            { id: 'Bad Id', roles: [{ id: 'a' }] },
            { id: 'demo:norole', roles: [] },
            { id: 'demo:free', roles: [{ id: 'a' }, { id: 'a' }, { id: 'b', skeleton: 'nope' }] },
        ] }), 'test');

        expect(parsed.templates.map(t => t.id)).toEqual(['demo:free']);
        expect(parsed.templates[0].roles.map(r => r.id)).toEqual(['a', 'b']);
        expect(parsed.templates[0].roles[1].skeleton).toBe('');
        expect(parsed.templates[0].freeClips).toBe(true);
        expect(parsed.problems.length).toBeGreaterThanOrEqual(4);
        expect(parseTemplates('nope', 'x').problems[0]).toMatch(/not valid JSON/);
        expect(parseTemplates(JSON.stringify({ version: 9, templates: [] }), 'x').problems[0]).toMatch(/newer/);
    });
});

describe('clip names', () => {
    test('a name is made from the phase, the variant and the side, and read back', () => {
        const t = template();

        expect(clipName(t, 'tango', 'intro')).toBe('animation.tango.intro');
        expect(clipName(t, 'tango', 'slow', 1, 'L')).toBe('animation.tango.slow_L');
        expect(clipName(t, 'tango', 'slow', 3, 'R')).toBe('animation.tango.slow_R_3');
        expect(identify(t, 'tango', 'animation.tango.slow_R_3')).toEqual({ phase: 'slow', variant: 3, side: 'R' });
        expect(identify(t, 'tango', 'animation.tango.intro')).toEqual({ phase: 'intro', variant: 1, side: '' });
        expect(identify(t, 'tango', 'animation.tango.dance')).toBeNull();
        expect(identify(t, 'waltz', 'animation.tango.intro')).toBeNull();
    });
});

describe('what a scene still needs', () => {
    const stage = (animations: StageAnimation[], actors: StageActor[]): Stage => ({ ...newStage('tango', 'demo'), actors, animations });

    test('an empty scene lacks its required role and phase', () => {
        const problems = checkAgainstTemplate(template(), stage([], []));

        // the slow phase asks for at least one variant, the end phase for none
        expect(problems.map(p => p.message)).toEqual([expect.stringContaining('Lead (lead) has no character'), expect.stringContaining('Intro: no clip yet'), expect.stringContaining('Slow: no clip yet')]);
        expect(problems.every(p => p.severity === 'error')).toBe(true);
    });

    test('a scene that follows the template has nothing wrong', () => {
        const animations = [clip('animation.tango.intro', 2, 'LOOP'), clip('animation.tango.slow_L', 1, 'LOOP'), clip('animation.tango.slow_R', 1, 'LOOP'), clip('animation.tango.end', 1, 'PLAY_ONCE')];

        expect(checkAgainstTemplate(template(), stage(animations, [actor('lead', 'demo:human'), actor('second', 'demo:robot')]))).toEqual([]);
    });

    test('a wrong skeleton, loop mode, length, a missing side and a stray clip are each said', () => {
        const animations = [clip('animation.tango.intro', 20, 'PLAY_ONCE'), clip('animation.tango.slow_L', 1, 'LOOP'), clip('animation.tango.jump', 1, 'LOOP'), clip('animation.tango.end', 1, 'PLAY_ONCE', [])];
        const messages = checkAgainstTemplate(template(), stage(animations, [actor('lead', 'demo:robot')])).map(p => p.message).join('\n');

        expect(messages).toContain('must be on the skeleton demo:human');
        expect(messages).toContain('should be looping');
        expect(messages).toContain('longer than 10s');
        expect(messages).toContain('variant 1 has no R clip');
        expect(messages).toContain('animation.tango.jump is not a clip of this kind of scene');
        expect(messages).toContain('lead has no keys in animation.tango.end');
    });

    test('the status of each phase counts variants and says what is missing', () => {
        const status = phaseStatus(template(), 'tango', [clip('animation.tango.slow_L', 1, 'LOOP'), clip('animation.tango.slow_L_2', 1, 'LOOP'), clip('animation.tango.slow_R', 1, 'LOOP')]);
        const slow = status.find(each => each.phase.id === 'slow')!;

        expect(slow.clips).toHaveLength(3);
        expect(slow.missing).toEqual(['variant 2 has no R clip']);
        expect(status.find(each => each.phase.id === 'intro')!.missing).toEqual(['no clip yet']);
    });
});

describe('the registry and the API', () => {
    test('the built-in templates are free scenes', () => {
        expect(BUILT_IN.map(t => t.id)).toEqual(['strut:free', 'strut:skeleton_clips']);
        expect(BUILT_IN.every(t => t.freeClips)).toBe(true);
    });

    test('another plugin registers templates, and a source replaces and removes its own', () => {
        const registry = new TemplateRegistry();
        const api = createApi(registry);
        let changes = 0;
        const stop = api.onTemplatesChanged(() => changes++);

        expect(api.apiVersion).toBe(1);
        expect(api.registerTemplate(JSON.parse(DOC).templates, 'demo')).toEqual({ ok: true, problems: [] });
        expect(api.templates().map(t => `${t.id}@${t.source}`)).toEqual(['strut:free@strut', 'strut:skeleton_clips@strut', 'demo:duet@api:demo']);

        // registering one with the same id again replaces it, another id is added
        api.registerTemplate({ id: 'demo:duet', name: 'Renamed', roles: [{ id: 'a' }] }, 'demo');
        api.registerTemplate({ id: 'demo:solo', roles: [{ id: 'a' }] }, 'demo');
        expect(registry.get('demo:duet')?.name).toBe('Renamed');
        expect(registry.get('demo:solo')).toBeDefined();

        // a template that is no good is refused and said
        const bad = api.registerTemplate({ id: 'x' }, 'demo');

        expect(bad.ok).toBe(false);
        expect(bad.problems.length).toBeGreaterThan(0);

        // a built in id is not taken over
        api.registerTemplate({ id: 'strut:free', name: 'Taken', roles: [{ id: 'a' }] }, 'demo');
        expect(registry.get('strut:free')?.name).toBe('Free scene');

        api.unregisterTemplates('demo');
        expect(api.templates().map(t => t.id)).toEqual(['strut:free', 'strut:skeleton_clips']);
        expect(changes).toBeGreaterThan(0);

        stop();

        const before = changes;

        api.registerTemplate({ id: 'demo:again', roles: [{ id: 'a' }] }, 'demo');
        expect(changes).toBe(before);
    });
});

describe('optional sides and any loop mode', () => {
    const loose = (): SceneTemplate => parseTemplates(JSON.stringify({
        templates: [{
            id: 'demo:loose', roles: [{ id: 'a' }],
            clips: { phases: [
                { id: 'slow', name: 'Slow', loop: 'any', variants: { min: 1, max: 2 }, sides: ['L', 'R', 'L_swap', 'R_swap'], sidesOptional: true, sidesRequired: ['L', 'R'] },
                { id: 'fast', name: 'Fast', loop: 'any', required: true },
            ] },
        }],
    }), 'test').templates[0];

    test('the flags are read, and the required sides default to all of them', () => {
        const t = loose();

        expect(t.phases[0]).toMatchObject({ loopAny: true, loop: 'loop', sidesOptional: true, sidesRequired: ['L', 'R'] });
        expect(template().phases[1]).toMatchObject({ loopAny: false, sidesOptional: false, sidesRequired: ['L', 'R'] });
    });

    test('a plain clip and a sided clip are both clips of the phase, with or without a side', () => {
        const t = loose();

        expect(identify(t, 'x', 'animation.x.slow')).toEqual({ phase: 'slow', variant: 1, side: '' });
        expect(identify(t, 'x', 'animation.x.slow_R_swap_2')).toEqual({ phase: 'slow', variant: 2, side: 'R_swap' });
    });

    test('a plain clip is a whole variant; sided clips need the required sides, and a plain one beside them is a mistake', () => {
        const t = loose();
        const slow = (clips: string[]): readonly string[] => phaseStatus(t, 'x', [...clips.map(name => clip(name, 1, 'PLAY_ONCE')), clip('animation.x.fast', 1, 'HOLD_ON_LAST_FRAME')])[0].missing;

        expect(slow(['animation.x.slow'])).toEqual([]);
        expect(slow(['animation.x.slow_L', 'animation.x.slow_R'])).toEqual([]);
        expect(slow(['animation.x.slow_L', 'animation.x.slow_R', 'animation.x.slow_L_swap'])).toEqual([]);
        expect(slow(['animation.x.slow_L'])).toEqual(['variant 1 has no R clip']);
        expect(slow(['animation.x.slow', 'animation.x.slow_L'])).toEqual(['variant 1 has a plain clip and sided ones: use one or the other']);
    });

    test('the loop mode is not checked when the template says any', () => {
        const t = loose();
        const status = phaseStatus(t, 'x', [clip('animation.x.slow', 1, 'PLAY_ONCE'), clip('animation.x.fast', 1, 'HOLD_ON_LAST_FRAME')]);

        expect(status.map(each => each.missing)).toEqual([[], []]);
    });
});
