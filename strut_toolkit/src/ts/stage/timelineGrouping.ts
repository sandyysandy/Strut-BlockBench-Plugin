/* eslint-disable @typescript-eslint/no-explicit-any */
import { isStrutWorkspace } from '../utils';
import { ACTOR_PREFIX } from './stageProject';

/**
 * Groups the timeline of a scene by character
 * <p>
 * Blockbench's timeline lists the bones that are selected, one row each, by their bone name, so in a scene two characters that have a bone called {@code root} are two
 * rows both called {@code root}. This puts each row under its character: a coloured band down its left edge, and a heading with the character's name over the first row of
 * each. It only sets data attributes on the rows the timeline makes (Vue owns their classes and content and would undo anything else), and the style does the rest, so
 * nothing is added to or taken out of what the timeline draws
 */

const PALETTE = ['#4fa3e0', '#e0735b', '#6cc17a', '#c98ae0', '#e0c24f', '#4fd0c0', '#e07fa6', '#a0a0a0'];
const STYLE_ID = 'strut_timeline_grouping';

const CSS = `
    #timeline_body .animator[data-character] { border-left: 3px solid var(--strut-character-colour, #888); }
    #timeline_body .animator[data-character-first]::before {
        content: attr(data-character);
        display: block;
        position: sticky;
        left: 0;
        padding: 1px 8px 1px 6px;
        margin-left: -3px;
        font-size: 0.78em;
        font-weight: bold;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--strut-character-colour, #888);
        background: var(--color-back);
        border-left: 3px solid var(--strut-character-colour, #888);
    }
`;

let observer: MutationObserver | null = null;
let style: HTMLStyleElement | null = null;
let pending = false;
let listeners: [string, () => void][] = [];

/** The role of the character whose bone {@code node} is, or null */
export function characterOf(node: any): string | null {
    for (let at = node; at; at = at.parent) {
        if (typeof at.name === 'string' && at.name.startsWith(ACTOR_PREFIX) && at.name.length > ACTOR_PREFIX.length && (at.parent === undefined || at.parent === 'root'))
            return at.name.slice(ACTOR_PREFIX.length);
    }

    return null;
}

/** The colour of the {@code index}th character */
export function colourOf(index: number): string {
    return PALETTE[index % PALETTE.length];
}

function decorate(): void {
    pending = false;

    const body = document.getElementById('timeline_body');

    if (!body)
        return;

    const rows = [...body.querySelectorAll<HTMLElement>('li.animator[uuid]')];
    const scene = isStrutWorkspace();
    const roles: string[] = [];
    let last: string | null = null;

    for (const row of rows) {
        const node = scene ? (globalThis as any).OutlinerNode?.uuids?.[row.getAttribute('uuid') ?? ''] : null;
        const role = node ? characterOf(node) : null;

        if (role === null) {
            row.removeAttribute('data-character');
            row.removeAttribute('data-character-first');
            row.style.removeProperty('--strut-character-colour');
            last = null;

            continue;
        }

        if (!roles.includes(role))
            roles.push(role);

        const first = role !== last;

        row.setAttribute('data-character', role);
        row.style.setProperty('--strut-character-colour', colourOf(roles.indexOf(role)));

        if (first)
            row.setAttribute('data-character-first', '');
        else
            row.removeAttribute('data-character-first');

        last = role;
    }
}

function schedule(): void {
    if (pending)
        return;

    pending = true;
    requestAnimationFrame(decorate);
}

export function loadTimelineGrouping(): void {
    const body = document.getElementById('timeline_body');

    if (!body || observer)
        return;

    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);

    observer = new MutationObserver(schedule);
    observer.observe(body, { childList: true, subtree: true });

    for (const event of ['select_project', 'select_mode', 'update_selection', 'finish_edit']) {
        const listener = (): void => schedule();

        (globalThis as any).Blockbench.on(event, listener);
        listeners.push([event, listener]);
    }

    schedule();
}

export function unloadTimelineGrouping(): void {
    observer?.disconnect();
    observer = null;
    style?.remove();
    style = null;

    for (const [event, listener] of listeners)
        (globalThis as any).Blockbench.removeListener(event, listener);

    listeners = [];

    for (const row of document.querySelectorAll<HTMLElement>('#timeline_body li.animator[data-character]')) {
        row.removeAttribute('data-character');
        row.removeAttribute('data-character-first');
        row.style.removeProperty('--strut-character-colour');
    }
}
