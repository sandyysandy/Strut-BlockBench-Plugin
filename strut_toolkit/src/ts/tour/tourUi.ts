/* eslint-disable @typescript-eslint/no-explicit-any */
import { Placement, TourRunner, TourStep, TourView } from './tourEngine';

/**
 * Draws a tour on the screen: the part of the screen a step is about is lit and the rest dimmed, with a card beside it that says what it is for
 * <p>
 * The card has Back, Next (Done on the last step) and Skip tour, and the keys do the same (Right and Enter go on, Left goes back, Escape skips), so a tour can be left
 * at any step in one press. A step whose target is not on the screen is a card in the middle. The lit part follows the target while the card is up, so a panel that
 * moves or a window that is resized does not leave it behind
 */

const STYLE_ID = 'strut_tour_style';
const Z = 100000;

const CSS = `
    .strut_tour_dim { position: fixed; inset: 0; z-index: ${Z}; background: rgba(0, 0, 0, 0.6); }
    .strut_tour_spot { position: fixed; z-index: ${Z + 1}; border-radius: 6px; pointer-events: none; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 0 2px var(--color-accent, #3a7bd5), 0 0 14px 2px var(--color-accent, #3a7bd5); transition: left 0.18s, top 0.18s, width 0.18s, height 0.18s; }
    .strut_tour_card { position: fixed; z-index: ${Z + 2}; width: 340px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 14px 16px 12px; border-radius: 8px;
        background: var(--color-ui, #2b2e35); color: var(--color-text, #ddd); border: 1px solid var(--color-border, #444); box-shadow: 0 6px 28px rgba(0, 0, 0, 0.55); font-size: 0.95em; line-height: 1.4; }
    .strut_tour_card h3 { margin: 0 0 8px 0; font-size: 1.15em; }
    .strut_tour_card p { margin: 0 0 8px 0; }
    .strut_tour_card .strut_tour_action { display: inline-block; margin: 2px 0 8px 0; padding: 5px 12px; cursor: pointer; border-radius: 4px; background: var(--color-accent, #3a7bd5); color: var(--color-light, #fff); }
    .strut_tour_card .strut_tour_foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .strut_tour_card .strut_tour_count { flex: 1; color: var(--color-subtle_text, #999); font-size: 0.85em; }
    .strut_tour_button { padding: 4px 12px; cursor: pointer; border-radius: 4px; background: var(--color-button, #444); }
    .strut_tour_button:hover { filter: brightness(1.2); }
    .strut_tour_button.primary { background: var(--color-accent, #3a7bd5); color: var(--color-light, #fff); }
    .strut_tour_button.quiet { background: transparent; color: var(--color-subtle_text, #999); }
    .strut_tour_button.disabled { opacity: 0.4; pointer-events: none; }
    .strut_tour_card .strut_tour_dots { display: flex; gap: 4px; margin-top: 10px; }
    .strut_tour_card .strut_tour_dot { width: 6px; height: 6px; border-radius: 3px; background: var(--color-border, #555); }
    .strut_tour_card .strut_tour_dot.on { background: var(--color-accent, #3a7bd5); }
    .strut_tour_offer { position: fixed; right: 16px; bottom: 16px; z-index: ${Z}; width: 320px; box-sizing: border-box; padding: 12px 14px; border-radius: 8px;
        background: var(--color-ui, #2b2e35); color: var(--color-text, #ddd); border: 1px solid var(--color-border, #444); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); font-size: 0.95em; line-height: 1.4; }
    .strut_tour_offer h3 { margin: 0 0 6px 0; font-size: 1.1em; }
    .strut_tour_offer p { margin: 0 0 8px 0; }
    .strut_tour_offer .row { display: flex; gap: 6px; flex-wrap: wrap; }
`;

let dim: HTMLElement | null = null;
let spot: HTMLElement | null = null;
let card: HTMLElement | null = null;
let follow: number | undefined;
let keys: ((event: KeyboardEvent) => void) | null = null;
let current: { step: TourStep; first: boolean; last: boolean } | null = null;
let offer: HTMLElement | null = null;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID))
        return;

    const style = document.createElement('style');

    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    if (className)
        node.className = className;

    if (text)
        node.textContent = text;

    return node;
}

/** The first element on the screen that a selector finds; a selector may also be {@code text:<tag>:<words>} for the first element of a kind that holds those words */
export function findTarget(selector: string | undefined): HTMLElement | null {
    if (!selector)
        return null;

    try {
        if (selector.startsWith('text:')) {
            const [, tag, words] = selector.split(':');

            return [...document.querySelectorAll<HTMLElement>(tag)].find(node => node.getBoundingClientRect().width > 0 && (node.textContent ?? '').trim().toLowerCase().startsWith(words.toLowerCase())) ?? null;
        }

        const found = document.querySelector<HTMLElement>(selector);
        const box = found?.getBoundingClientRect();

        // on the screen if it has a size (an element in a fixed or flex parent has no offsetParent, and is still there)
        return found && box && box.width > 0 && box.height > 0 ? found : null;
    }
    catch {
        return null;
    }
}

/** Where the card goes beside {@code rect}, kept inside the window */
export function cardPosition(rect: { left: number; top: number; width: number; height: number } | null, cardSize: { width: number; height: number }, view: { width: number; height: number },
                             placement: Placement = 'right'): { left: number; top: number } {
    const gap = 14;
    const clamp = (value: number, size: number, limit: number): number => Math.max(10, Math.min(value, limit - size - 10));

    if (!rect || placement === 'center')
        return { left: (view.width - cardSize.width) / 2, top: Math.max(10, (view.height - cardSize.height) / 2) };

    const order: Placement[] = [placement, 'right', 'left', 'bottom', 'top'];

    for (const side of order) {
        let left: number;
        let top: number;

        if (side === 'right') {
            left = rect.left + rect.width + gap;
            top = rect.top;
        }
        else if (side === 'left') {
            left = rect.left - cardSize.width - gap;
            top = rect.top;
        }
        else if (side === 'bottom') {
            left = rect.left;
            top = rect.top + rect.height + gap;
        }
        else {
            left = rect.left;
            top = rect.top - cardSize.height - gap;
        }

        const fits = left >= 10 && top >= 10 && left + cardSize.width <= view.width - 10 && top + cardSize.height <= view.height - 10;

        // right and left may hang off the bottom: they slide up, which keeps them beside the target
        if (fits || ((side === 'right' || side === 'left') && left >= 10 && left + cardSize.width <= view.width - 10))
            return { left: clamp(left, cardSize.width, view.width), top: clamp(top, cardSize.height, view.height) };

        if (fits)
            return { left, top };
    }

    // nowhere beside it: over the middle of it, which at least keeps the card on the screen
    return { left: clamp(rect.left, cardSize.width, view.width), top: clamp(rect.top + rect.height / 2 - cardSize.height / 2, cardSize.height, view.height) };
}

function place(): void {
    if (!card || !current)
        return;

    const target = findTarget(current.step.target);
    const rect = target ? target.getBoundingClientRect() : null;

    if (spot) {
        if (rect && rect.width > 0 && rect.height > 0) {
            spot.style.display = 'block';
            spot.style.left = `${rect.left - 5}px`;
            spot.style.top = `${rect.top - 5}px`;
            spot.style.width = `${rect.width + 10}px`;
            spot.style.height = `${rect.height + 10}px`;
        }
        else {
            spot.style.display = 'none';
        }
    }

    if (dim)
        dim.style.display = rect ? 'none' : 'block';

    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const where = cardPosition(rect && rect.width > 0 ? rect : null, size, { width: window.innerWidth, height: window.innerHeight }, current.step.placement);

    card.style.left = `${where.left}px`;
    card.style.top = `${where.top}px`;
}

function detach(): void {
    dim?.remove();
    spot?.remove();
    card?.remove();
    dim = spot = card = null;
    current = null;

    if (follow !== undefined) {
        clearInterval(follow);
        follow = undefined;
    }

    if (keys) {
        document.removeEventListener('keydown', keys, true);
        keys = null;
    }

    window.removeEventListener('resize', place);
}

export function createTourView(getRunner: () => TourRunner): TourView {
    return {
        show(step, position) {
            ensureStyle();
            dismissOffer();

            if (!card) {
                dim = element('div', 'strut_tour_dim');
                spot = element('div', 'strut_tour_spot');
                card = element('div', 'strut_tour_card');
                document.body.append(dim, spot, card);
                window.addEventListener('resize', place);
                follow = window.setInterval(place, 250);
                keys = event => {
                    const runner = getRunner();

                    if (!runner.running)
                        return;

                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        runner.skip();
                    }
                    else if (event.key === 'ArrowRight' || event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        void runner.next();
                    }
                    else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        event.stopPropagation();
                        void runner.back();
                    }
                };
                document.addEventListener('keydown', keys, true);
            }

            current = { step, first: position.first, last: position.last };
            card.replaceChildren();
            card.append(element('h3', '', step.title));

            for (const paragraph of step.body)
                card.append(element('p', '', paragraph));

            const runner = getRunner();

            if (step.action) {
                const action = element('div', 'strut_tour_action', step.action.label);

                action.addEventListener('click', () => void runner.runAction());
                card.append(action);
            }

            const foot = element('div', 'strut_tour_foot');
            const skip = element('div', 'strut_tour_button quiet', position.last ? 'Close' : 'Skip tour');
            const back = element('div', `strut_tour_button${position.first ? ' disabled' : ''}`, 'Back');
            const next = element('div', 'strut_tour_button primary', position.last ? 'Done' : 'Next');

            skip.addEventListener('click', () => runner.skip());
            back.addEventListener('click', () => void runner.back());
            next.addEventListener('click', () => void runner.next());
            foot.append(element('div', 'strut_tour_count', `Step ${position.index + 1} of ${position.total}`), skip, back, next);
            card.append(foot);

            const dots = element('div', 'strut_tour_dots');

            for (let i = 0; i < position.total; i++)
                dots.append(element('div', `strut_tour_dot${i === position.index ? ' on' : ''}`));

            card.append(dots);
            place();
            // the step may have opened a panel that is still drawing
            window.setTimeout(place, 80);
        },
        hide() {
            detach();
        },
    };
}

// ===============================================================
// The invitation
// ===============================================================

export function dismissOffer(): void {
    offer?.remove();
    offer = null;
}

/** A small card in the corner that offers a tour once: start it, not now, or never */
export function showOffer(options: { title: string; text: string; start(): void; never(): void }): void {
    ensureStyle();
    dismissOffer();

    offer = element('div', 'strut_tour_offer');
    offer.append(element('h3', '', options.title), element('p', '', options.text));

    const row = element('div', 'row');
    const start = element('div', 'strut_tour_button primary', 'Take the tour');
    const later = element('div', 'strut_tour_button', 'Not now');
    const never = element('div', 'strut_tour_button quiet', 'Do not ask again');

    start.addEventListener('click', () => {
        dismissOffer();
        options.start();
    });
    later.addEventListener('click', dismissOffer);
    never.addEventListener('click', () => {
        dismissOffer();
        options.never();
    });
    row.append(start, later, never);
    offer.append(row);
    document.body.append(offer);
}
