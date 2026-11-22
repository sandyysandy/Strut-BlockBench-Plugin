/**
 * The guided tours: what a tour is, and the runner that walks a person through one
 * <p>
 * A tour is a list of steps. Each step points at a part of the screen (or at nothing, for a plain card), says what it is for in a few short paragraphs, and may offer one
 * button that does something for the person (open a panel, start a practice scene). The runner knows nothing about the screen: it asks a view to show a step, and the
 * person's presses come back as {@link TourRunner#next}, {@link TourRunner#back}, {@link TourRunner#skip} and {@link TourRunner#finish}. A tour can be left at any
 * step, and started again from any of its menus. Pure: no Blockbench and no DOM, so it is tested without either
 */

export type Placement = 'right' | 'left' | 'top' | 'bottom' | 'center';

export interface TourAction {
    readonly label: string;
    run(): void | Promise<void>;
}

export interface TourStep {
    readonly id: string;
    readonly title: string;
    /** Short paragraphs, shown one under the other */
    readonly body: readonly string[];
    /** A CSS selector for what the step points at; a step with none, or whose target is not on the screen, is a card in the middle */
    readonly target?: string;
    readonly placement?: Placement;
    /** Run before the step is shown, to bring what it points at onto the screen */
    before?(): void | Promise<void>;
    /** A button on the card that does something for the person */
    readonly action?: TourAction;
    /** The step is left out when this says false (a step about a scene, when no scene is open and the tour has not started one) */
    when?(): boolean;
}

export interface Tour {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly steps: readonly TourStep[];
}

/** What the runner asks of whatever draws the tour */
export interface TourView {
    show(step: TourStep, position: { index: number; total: number; first: boolean; last: boolean }): void;
    hide(): void;
}

/** Where what the tours remember is kept: the browser's storage, or anything with these two */
export interface TourStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const DONE = 'strut_tour_done:';
const DISMISSED = 'strut_tour_dismissed:';

/** Which tours have been taken or turned away, so they are offered once and never pushed */
export class TourStore {
    constructor(private readonly storage: TourStorage | null) {}

    private read(key: string): boolean {
        try {
            return this.storage?.getItem(key) === '1';
        }
        catch {
            return false;
        }
    }

    private write(key: string, value: boolean): void {
        try {
            this.storage?.setItem(key, value ? '1' : '0');
        }
        catch {
            // no storage: it is offered again next time, which is harmless
        }
    }

    /** Taken to the end, or skipped */
    isDone(id: string): boolean {
        return this.read(DONE + id);
    }

    markDone(id: string): void {
        this.write(DONE + id, true);
    }

    /** "Do not ask again" */
    isDismissed(id: string): boolean {
        return this.read(DISMISSED + id);
    }

    dismiss(id: string): void {
        this.write(DISMISSED + id, true);
    }

    /** Whether it is time to offer the tour: not taken, not skipped, not turned away */
    shouldOffer(id: string): boolean {
        return !this.isDone(id) && !this.isDismissed(id);
    }

    reset(id: string): void {
        this.write(DONE + id, false);
        this.write(DISMISSED + id, false);
    }
}

export class TourRunner {
    private tour: Tour | null = null;
    private steps: readonly TourStep[] = [];
    private index = 0;
    private busy = false;

    constructor(private readonly view: TourView, private readonly store: TourStore) {}

    get running(): boolean {
        return this.tour !== null;
    }

    get current(): TourStep | null {
        return this.tour ? this.steps[this.index] ?? null : null;
    }

    get tourId(): string | null {
        return this.tour?.id ?? null;
    }

    /** Starts {@code tour} at its first step (or step {@code at} of those that are shown); a tour already running is left */
    async start(tour: Tour, at = 0): Promise<void> {
        if (this.tour)
            this.close();

        this.tour = tour;
        this.steps = tour.steps.filter(step => step.when?.() !== false);
        this.index = Math.max(0, Math.min(at, this.steps.length - 1));

        if (this.steps.length === 0) {
            this.tour = null;

            return;
        }

        await this.render();
    }

    async next(): Promise<void> {
        if (!this.tour || this.busy)
            return;

        if (this.index >= this.steps.length - 1) {
            this.finish();

            return;
        }

        this.index++;
        await this.render();
    }

    async back(): Promise<void> {
        if (!this.tour || this.busy || this.index === 0)
            return;

        this.index--;
        await this.render();
    }

    /** Leaves the tour now. It counts as seen: a person who skips is not offered it again, but can start it from its menu whenever they like */
    skip(): void {
        this.end();
    }

    /** The last step's button */
    finish(): void {
        this.end();
    }

    /** Leaves without remembering anything (the tour was replaced, or Blockbench is closing) */
    close(): void {
        this.tour = null;
        this.steps = [];
        this.view.hide();
    }

    /** Runs a step's own button, if it has one, and shows the step again: what it did may have changed what is on the screen */
    async runAction(): Promise<void> {
        const step = this.current;

        if (!step?.action || this.busy)
            return;

        this.busy = true;

        try {
            await step.action.run();
        }
        finally {
            this.busy = false;
        }

        // the action may have made steps that were left out meaningful: they are looked at again, staying on the same step
        if (this.tour) {
            const id = step.id;
            const was = this.index;

            this.steps = this.tour.steps.filter(each => each.when?.() !== false);

            const found = this.steps.findIndex(each => each.id === id);

            // a step that did its job and is now left out (a practice scene was started) leaves the tour at the step that follows it
            this.index = found >= 0 ? found : Math.max(0, Math.min(was, this.steps.length - 1));
            await this.render();
        }
    }

    private end(): void {
        const id = this.tour?.id;

        this.close();

        if (id)
            this.store.markDone(id);
    }

    private async render(): Promise<void> {
        const step = this.steps[this.index];

        this.busy = true;

        try {
            await step.before?.();
        }
        catch (error) {
            console.warn(`[Strut tour] the step "${step.id}" could not be prepared`, error);
        }
        finally {
            this.busy = false;
        }

        // the tour may have been left while the step was being prepared
        if (this.tour && this.steps[this.index] === step)
            this.view.show(step, { index: this.index, total: this.steps.length, first: this.index === 0, last: this.index === this.steps.length - 1 });
    }
}
