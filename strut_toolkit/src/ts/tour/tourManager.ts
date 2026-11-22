/* eslint-disable @typescript-eslint/no-explicit-any */
import { isStrutModelProject, isStrutWorkspace } from '../utils';
import { Tour, TourRunner, TourStore } from './tourEngine';
import { createTours, SCENES_TOUR, TOOLKIT_TOUR } from './tours';
import { createTourView, dismissOffer, showOffer } from './tourUi';

/**
 * The tours as the plugin uses them: one runner, the Help menu entries that start each tour, and the one-time offer when someone first opens a project of a kind a tour is
 * about. A tour is offered once and never pushed: "Not now" asks again next time, "Do not ask again" and finishing or skipping do not
 */

function storage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    }
    catch {
        return null;
    }
}

const store = new TourStore(storage());
let runner: TourRunner | null = null;
let tours: Tour[] = [];
let startPractice: () => Promise<void> = async () => undefined;
let offeredThisSession = new Set<string>();

function theRunner(): TourRunner {
    if (!runner)
        runner = new TourRunner(createTourView(theRunner), store);

    return runner;
}

export function startTour(id: string): void {
    const tour = tours.find(each => each.id === id);

    if (tour)
        void theRunner().start(tour);
}

/** What an opened project makes worth offering */
function offerFor(): string | null {
    if (isStrutWorkspace())
        return SCENES_TOUR;

    return isStrutModelProject() ? TOOLKIT_TOUR : null;
}

function maybeOffer(): void {
    const id = offerFor();

    if (id === null || offeredThisSession.has(id) || !store.shouldOffer(id) || theRunner().running)
        return;

    const tour = tours.find(each => each.id === id);

    if (!tour)
        return;

    offeredThisSession.add(id);

    // a moment after the project is on the screen, so the offer does not cover what is still being drawn
    window.setTimeout(() => {
        if (offerFor() !== id || theRunner().running)
            return;

        showOffer({
            title: id === SCENES_TOUR ? 'New to Strut Scenes?' : 'New to the Strut Toolkit?',
            text: id === SCENES_TOUR ? 'A short tour shows how to make a scene: characters, clips, checking and exporting.' : 'A short tour shows what the Toolkit adds to Blockbench and how it fits together.',
            start: () => startTour(id),
            never: () => store.dismiss(id),
        });
    }, 1200);
}

export function loadTours(options: { startPracticeScene(): Promise<void> }): void {
    startPractice = options.startPracticeScene;
    offeredThisSession = new Set();
    tours = createTours({
        inScene: () => isStrutWorkspace(),
        startPracticeScene: () => startPractice(),
        showAnimate: () => {
            if (isStrutWorkspace() && Mode.selected?.id !== 'animate')
                (Modes as any).options.animate.select();
        },
        start: startTour,
    });
    Blockbench.on('select_project', maybeOffer);
}

export function unloadTours(): void {
    Blockbench.removeListener('select_project', maybeOffer);
    runner?.close();
    runner = null;
    dismissOffer();
}

/** The Help menu entries: each tour can be played at any time, whether or not it was taken */
export function createTourMenuItems(): { action: Action; menuCategory: string }[] {
    const item = (id: string, name: string, icon: string, description: string, tour: string): { action: Action; menuCategory: string } => ({
        action: new (Action as any)(id, { name, icon, description, category: 'help', click: () => startTour(tour) }),
        menuCategory: 'help',
    });

    return [
        item('strut_tour_toolkit', 'Strut Toolkit Tour', 'school', 'A short guided tour of what the Strut Toolkit adds to Blockbench. It can be skipped at any step and played again at any time', TOOLKIT_TOUR),
        item('strut_tour_scenes', 'Strut Scenes Tour', 'theaters', 'A guided tour of making a scene for several characters, with a practice scene to follow along. It can be skipped at any step and played again at any time', SCENES_TOUR),
    ];
}
