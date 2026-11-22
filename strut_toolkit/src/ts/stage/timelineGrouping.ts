/* eslint-disable @typescript-eslint/no-explicit-any */
import { isStrutWorkspace } from '../utils';
import { ACTOR_PREFIX } from './stageProject';

/**
 * Groups the timeline of a scene by character
 * <p>
 * Blockbench's timeline lists the bones that are selected, one row each, by their bone name and in the order they were selected, so in a scene two characters that have a
 * bone called {@code root} are two rows both called {@code root}, mixed together. This puts the rows of each character together (the list is sorted by character, in the
 * outliner's order), under a heading with the character's name that can be folded away, and a coloured band down their left edge. Only the order of the list is
 * changed, and data attributes are set on the rows the timeline makes (Vue owns their classes and content and would undo anything else); the style does the rest, so
 * nothing is added to or taken out of what the timeline draws
 */

const PALETTE = ['#4fa3e0', '#e0735b', '#6cc17a', '#c98ae0', '#e0c24f', '#4fd0c0', '#e07fa6', '#a0a0a0'];
const STYLE_ID = 'strut_timeline_grouping';

const CSS = `
    #timeline_body .animator[data-character] { border-left: 3px solid var(--strut-character-colour, #888); }
    #timeline_body .animator[data-character-first]::before {
        content: attr(data-chevron) "  " attr(data-character);
        cursor: pointer;
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
    #timeline_body .animator[data-character][data-collapsed]:not([data-character-first]) { display: none; }
    #timeline_body .animator[data-character-first][data-collapsed] > * { display: none; }
`;

let observer: MutationObserver | null = null;
let style: HTMLStyleElement | null = null;
let pending = false;
let listeners: [string, () => void][] = [];
/** The characters whose rows are folded away */
const collapsed = new Set<string>();

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

/** Where a character's rows come in the list: the order of the characters in the outliner; rows that are no character's (the effects) come first */
function rankOf(animator: any, order: readonly string[]): number {
    const node = (globalThis as any).OutlinerNode?.uuids?.[animator.uuid];
    const role = node ? characterOf(node) : null;

    return role === null ? -1 : order.indexOf(role);
}

/** Puts the rows of each character together, keeping their order inside it; true if the list had to be changed */
function sortByCharacter(): boolean {
    const animators: any[] | undefined = (globalThis as any).Timeline?.animators;

    if (!animators || animators.length < 2)
        return false;

    const order = ((globalThis as any).Outliner?.root as any[] ?? []).filter(node => typeof node?.name === 'string' && node.name.startsWith(ACTOR_PREFIX)).map(node => (node.name as string).slice(ACTOR_PREFIX.length));
    const sorted = animators.map((animator, index) => ({ animator, index, rank: rankOf(animator, order) })).sort((a, b) => a.rank - b.rank || a.index - b.index);

    if (sorted.every((entry, index) => entry.animator === animators[index]))
        return false;

    animators.splice(0, animators.length, ...sorted.map(entry => entry.animator));

    return true;
}

function decorate(): void {
    pending = false;

    const body = document.getElementById('timeline_body');

    if (!body)
        return;

    // the list changes, the timeline draws it again, and this runs again on what it drew
    if (isStrutWorkspace() && sortByCharacter()) {
        setTimeout(schedule, 60);

        return;
    }

    const rows = [...body.querySelectorAll<HTMLElement>('li.animator[uuid]')];
    const scene = isStrutWorkspace();
    const roles: string[] = [];
    let last: string | null = null;

    for (const row of rows) {
        const node = scene ? (globalThis as any).OutlinerNode?.uuids?.[row.getAttribute('uuid') ?? ''] : null;
        const role = node ? characterOf(node) : null;

        if (role === null) {
            clear(row);
            last = null;

            continue;
        }

        if (!roles.includes(role))
            roles.push(role);

        const first = role !== last;

        row.setAttribute('data-character', role);
        row.style.setProperty('--strut-character-colour', colourOf(roles.indexOf(role)));

        if (collapsed.has(role))
            row.setAttribute('data-collapsed', '');
        else
            row.removeAttribute('data-collapsed');

        if (first) {
            row.setAttribute('data-character-first', '');
            row.setAttribute('data-chevron', collapsed.has(role) ? '\u25B8' : '\u25BE');
        }
        else {
            row.removeAttribute('data-character-first');
            row.removeAttribute('data-chevron');
        }

        last = role;
    }
}

function clear(row: HTMLElement): void {
    row.removeAttribute('data-character');
    row.removeAttribute('data-character-first');
    row.removeAttribute('data-collapsed');
    row.removeAttribute('data-chevron');
    row.style.removeProperty('--strut-character-colour');
}

/** A click on a character's heading (the top of its first row) folds the character's rows away, or opens them again */
function onClick(event: MouseEvent): void {
    const row = event.target as HTMLElement | null;

    if (!row || row.tagName !== 'LI' || !row.hasAttribute('data-character-first'))
        return;

    const height = parseFloat(getComputedStyle(row, '::before').height) || 18;

    if (event.offsetY > height)
        return;

    const role = row.getAttribute('data-character') ?? '';

    if (collapsed.has(role))
        collapsed.delete(role);
    else
        collapsed.add(role);

    event.stopPropagation();
    event.preventDefault();
    schedule();
}

function schedule(): void {
    if (pending)
        return;

    pending = true;

    // on the next frame, or soon after if frames are not being drawn (a hidden window): whichever comes first
    const run = (): void => {
        if (pending)
            decorate();
    };

    requestAnimationFrame(run);
    setTimeout(run, 50);
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
    body.addEventListener('click', onClick, true);

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
    document.getElementById('timeline_body')?.removeEventListener('click', onClick, true);
    style?.remove();
    style = null;

    for (const [event, listener] of listeners)
        (globalThis as any).Blockbench.removeListener(event, listener);

    listeners = [];

    for (const row of document.querySelectorAll<HTMLElement>('#timeline_body li.animator[data-character]'))
        clear(row);
}
