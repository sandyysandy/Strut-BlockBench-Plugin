import { Tour, TourRunner, TourStep, TourStore, TourView } from '../ts/tour/tourEngine';

class MemoryStorage {
    readonly data = new Map<string, string>();

    getItem(key: string): string | null {
        return this.data.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.data.set(key, value);
    }
}

class FakeView implements TourView {
    readonly shown: string[] = [];
    readonly positions: { index: number; total: number; first: boolean; last: boolean }[] = [];
    hidden = 0;

    show(step: TourStep, position: { index: number; total: number; first: boolean; last: boolean }): void {
        this.shown.push(step.id);
        this.positions.push(position);
    }

    hide(): void {
        this.hidden++;
    }
}

const step = (id: string, extra: Partial<TourStep> = {}): TourStep => ({ id, title: id, body: [id], ...extra });

function setup(steps: TourStep[]): { view: FakeView; store: TourStore; storage: MemoryStorage; runner: TourRunner; tour: Tour } {
    const view = new FakeView();
    const storage = new MemoryStorage();
    const store = new TourStore(storage);

    return { view, store, storage, runner: new TourRunner(view, store), tour: { id: 'demo', name: 'Demo', description: '', steps } };
}

describe('walking a tour', () => {
    test('it starts at the first step, goes forward and back, and says where it is', async () => {
        const { view, runner, tour } = setup([step('a'), step('b'), step('c')]);

        await runner.start(tour);
        await runner.next();
        await runner.next();
        await runner.back();

        expect(view.shown).toEqual(['a', 'b', 'c', 'b']);
        expect(view.positions[0]).toEqual({ index: 0, total: 3, first: true, last: false });
        expect(view.positions[2]).toEqual({ index: 2, total: 3, first: false, last: true });
        expect(runner.running).toBe(true);
    });

    test('back at the first step does nothing, and next at the last finishes', async () => {
        const { view, store, runner, tour } = setup([step('a'), step('b')]);

        await runner.start(tour);
        await runner.back();
        expect(view.shown).toEqual(['a']);

        await runner.next();
        await runner.next();

        expect(runner.running).toBe(false);
        expect(view.hidden).toBe(1);
        expect(store.isDone('demo')).toBe(true);
    });

    test('skipping leaves at once and counts as seen, so the tour is not offered again but can still be started', async () => {
        const { view, store, runner, tour } = setup([step('a'), step('b'), step('c')]);

        expect(store.shouldOffer('demo')).toBe(true);

        await runner.start(tour);
        await runner.next();
        runner.skip();

        expect(runner.running).toBe(false);
        expect(view.hidden).toBe(1);
        expect(store.shouldOffer('demo')).toBe(false);

        await runner.start(tour);
        expect(view.shown.slice(-1)).toEqual(['a']);
    });

    test('a step whose condition is false is left out, and the totals count what is shown', async () => {
        const { view, runner, tour } = setup([step('a'), step('b', { when: () => false }), step('c')]);

        await runner.start(tour);
        await runner.next();

        expect(view.shown).toEqual(['a', 'c']);
        expect(view.positions[1]).toEqual({ index: 1, total: 2, first: false, last: true });
    });

    test('a step is prepared before it is shown, and one that cannot be prepared is still shown', async () => {
        const order: string[] = [];
        const { view, runner, tour } = setup([
            step('a', { before: async () => void order.push('before a') }),
            step('b', { before: () => { throw new Error('no panel'); } }),
        ]);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await runner.start(tour);
        order.push('shown a');
        await runner.next();

        expect(order).toEqual(['before a', 'shown a']);
        expect(view.shown).toEqual(['a', 'b']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test('a step\'s button runs, and the steps are looked at again: one that was left out can come in', async () => {
        let started = false;
        const { view, runner, tour } = setup([
            step('a', { action: { label: 'Start', run: () => { started = true; } } }),
            step('b', { when: () => started }),
        ]);

        await runner.start(tour);
        expect(view.positions[0].total).toBe(1);

        await runner.runAction();

        expect(started).toBe(true);
        expect(view.shown).toEqual(['a', 'a']);
        expect(view.positions[1]).toEqual({ index: 0, total: 2, first: true, last: false });
    });

    test('a step that did its job and is left out afterwards leaves the tour at the step that follows', async () => {
        let started = false;
        const { view, runner, tour } = setup([
            step('a'),
            step('practice', { when: () => !started, action: { label: 'Start', run: () => { started = true; } } }),
            step('c'),
        ]);

        await runner.start(tour);
        await runner.next();
        await runner.runAction();

        expect(view.shown).toEqual(['a', 'practice', 'c']);
        expect(view.positions[2]).toEqual({ index: 1, total: 2, first: false, last: true });
    });

    test('a tour with no steps to show does not start, and starting another replaces the first without calling it seen', async () => {
        const { view, store, runner, tour } = setup([step('a')]);

        await runner.start({ ...tour, id: 'empty', steps: [step('x', { when: () => false })] });
        expect(runner.running).toBe(false);

        await runner.start(tour);
        await runner.start({ ...tour, id: 'other', steps: [step('z')] });

        expect(runner.tourId).toBe('other');
        expect(view.shown).toEqual(['a', 'z']);
        expect(store.isDone('demo')).toBe(false);
    });
});

describe('what the tours remember', () => {
    test('done, turned away and reset are kept apart per tour', () => {
        const storage = new MemoryStorage();
        const store = new TourStore(storage);

        store.markDone('one');
        store.dismiss('two');

        expect(store.shouldOffer('one')).toBe(false);
        expect(store.shouldOffer('two')).toBe(false);
        expect(store.shouldOffer('three')).toBe(true);
        expect(new TourStore(storage).isDone('one')).toBe(true);

        store.reset('one');
        store.reset('two');

        expect(store.shouldOffer('one')).toBe(true);
        expect(store.shouldOffer('two')).toBe(true);
    });

    test('with no storage, or storage that throws, nothing breaks and the tour is simply offered', () => {
        const none = new TourStore(null);
        const broken = new TourStore({ getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } });

        none.markDone('x');
        broken.markDone('x');

        expect(none.shouldOffer('x')).toBe(true);
        expect(broken.shouldOffer('x')).toBe(true);
    });
});

describe('where the card goes', () => {
    const view = { width: 1000, height: 700 };
    const card = { width: 340, height: 200 };

    // imported here so the file's other tests do not need the module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cardPosition } = require('../ts/tour/tourUi');

    test('beside the target on the side asked for, and in the middle with no target', () => {
        expect(cardPosition({ left: 100, top: 100, width: 200, height: 100 }, card, view, 'right')).toEqual({ left: 314, top: 100 });
        expect(cardPosition({ left: 600, top: 100, width: 200, height: 100 }, card, view, 'left')).toEqual({ left: 246, top: 100 });
        expect(cardPosition(null, card, view)).toEqual({ left: 330, top: 250 });
        expect(cardPosition({ left: 0, top: 0, width: 10, height: 10 }, card, view, 'center')).toEqual({ left: 330, top: 250 });
    });

    test('it stays on the screen: a target at the right edge puts the card on its left, and one low down slides the card up', () => {
        const atEdge = cardPosition({ left: 900, top: 100, width: 90, height: 100 }, card, view, 'right');

        expect(atEdge.left + card.width).toBeLessThanOrEqual(view.width - 10);
        expect(atEdge.left + card.width).toBeLessThanOrEqual(900);

        const low = cardPosition({ left: 100, top: 650, width: 200, height: 40 }, card, view, 'right');

        expect(low.top + card.height).toBeLessThanOrEqual(view.height - 10);
        expect(low.left).toBe(314);
    });
});
