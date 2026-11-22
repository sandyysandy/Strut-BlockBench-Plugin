/* eslint-disable @typescript-eslint/no-explicit-any */
import { Tour } from './tourEngine';

/**
 * The tours: what the Toolkit is for, and how to make a scene
 * <p>
 * Each is written for someone who has never used the plugin. A step says what a part of the screen is for and what to do with it, in a few lines, and points at it. What
 * the tours need from the rest of the plugin comes in through {@link TourContext}, so the text and the order are here and nothing in this file touches Blockbench
 */

export interface TourContext {
    /** Whether a Strut Scenes project is the one open */
    inScene(): boolean;
    /** Opens a practice scene (a free scene, named practice) so the tour has something to point at */
    startPracticeScene(): Promise<void>;
    /** Makes sure Animate mode is the one shown, which is where a scene is made */
    showAnimate(): void;
    /** Starts another tour by its id */
    start(id: string): void;
}

export const TOOLKIT_TOUR = 'toolkit';
export const SCENES_TOUR = 'scenes';

export function createTours(context: TourContext): Tour[] {
    return [
        {
            id: TOOLKIT_TOUR,
            name: 'Strut Toolkit: the basics',
            description: 'What the Toolkit adds to Blockbench, from a model to a file the game reads',
            steps: [
                {
                    id: 'welcome',
                    title: 'Welcome to the Strut Toolkit',
                    body: [
                        'Strut is a mod that animates and simulates models. This plugin is where those models and their animations are made: it exports the files Strut reads.',
                        'This tour takes a couple of minutes. You can skip it at any step with Skip tour or Escape, and play it again from the Help menu whenever you like.',
                    ],
                },
                {
                    id: 'projects',
                    title: 'Two kinds of project',
                    body: [
                        'A Strut Animated Model is one character, block or item: its bones (groups), its cubes and meshes, its animations and its physics.',
                        'Strut Scenes is for scenes that several characters take part in, animated together on one timeline. The second tour is about that.',
                        'Both are in File, New.',
                    ],
                    target: 'text:li:file',
                    placement: 'bottom',
                },
                {
                    id: 'skeleton',
                    title: 'The skeleton ID',
                    body: [
                        'Models that share a rig share a skeleton ID, such as my_mod:humanoid. Set it in File, Project (the Skeleton ID field).',
                        'It is written into the model and into every animation exported from it. An animation made for a skeleton plays on every model with that ID, and a scene only lets a character fill a role made for its skeleton.',
                        'Leave it empty for a model that is not used in scenes.',
                    ],
                },
                {
                    id: 'physics',
                    title: 'Physics',
                    body: [
                        'The Physics mode (beside Edit, Paint and Animate) makes bones springs or chains, meshes cloth or flesh, and fits collision shapes. Simulate runs the real solvers on your model.',
                        'The physics is saved with the model. Tools, Physics as JSON shows the same data as text.',
                    ],
                },
                {
                    id: 'animate',
                    title: 'Animating',
                    body: [
                        'Animate as usual. Strut adds easing to keyframes (the Keyframe panel), expressions, and sounds, particles and events on the timeline.',
                        'Animations are exported in one file for the model, and carry its skeleton ID.',
                    ],
                },
                {
                    id: 'armour',
                    title: 'Armour',
                    body: [
                        'Armour is its own model, made on top of a character\'s skeleton. Mark the groups that hold a piece with Armour slot, and export a slot model from them. Armour that sits on a bone with flesh moves with it.',
                    ],
                },
                {
                    id: 'export',
                    title: 'Exporting',
                    body: [
                        'File, Export has Export Strut Model (Binary) and Export Strut Animations (Binary), plus the armour exports. The files go into your mod\'s assets, or a pack made with the Pack Creator.',
                    ],
                    target: 'text:li:file',
                    placement: 'bottom',
                },
                {
                    id: 'to-scenes',
                    title: 'Next: Strut Scenes',
                    body: ['Making a scene for several characters works differently. The next tour shows how, with a practice scene you can throw away.'],
                    action: { label: 'Take the Strut Scenes tour', run: () => context.start(SCENES_TOUR) },
                },
                {
                    id: 'help',
                    title: 'Find this again',
                    body: ['Help, Strut Toolkit Tour plays this tour, and Help, Strut Scenes Tour the other. The plugin\'s documentation is in its repository, in the docs folder.'],
                    target: 'text:li:help',
                    placement: 'bottom',
                },
            ],
        },
        {
            id: SCENES_TOUR,
            name: 'Strut Scenes: making a scene',
            description: 'Several characters, one timeline: roles, characters, clips, checking and exporting',
            steps: [
                {
                    id: 'welcome',
                    title: 'Making a scene',
                    body: [
                        'A scene is a few characters playing clips together. You animate all of them on one timeline, and the export splits it: each character gets its own file of clips, and the scene gets a layout that says who takes part and what the clips are.',
                        'You can skip at any step and replay the tour from Help.',
                    ],
                },
                {
                    id: 'practice',
                    title: 'A practice scene',
                    body: ['No scene is open. Start a practice scene to follow along; it is an ordinary project you can close without saving.'],
                    action: { label: 'Start a practice scene', run: () => context.startPracticeScene() },
                    when: () => !context.inScene(),
                },
                {
                    id: 'panel',
                    title: 'The Scene panel',
                    body: [
                        'Everything about the scene is here: its name and kind at the top, then its characters, its clips, and Check and Export at the foot.',
                        'The line above Check says how many things are still to do.',
                    ],
                    target: '#panel_strut_scene',
                    placement: 'right',
                    before: () => context.showAnimate(),
                },
                {
                    id: 'kind',
                    title: 'The kind of scene',
                    body: [
                        'A scene has a kind. A kind says who takes part, which skeleton each role needs, and which clips there are: what they are called, whether they loop, how long they may be.',
                        'The gear at the top of the panel opens Scene Settings, where you choose the kind, name the scene and set its namespace (your mod\'s id). A free scene has no rules; a mod or a tool that knows your game adds the real kinds.',
                    ],
                    target: '#panel_strut_scene',
                    placement: 'right',
                },
                {
                    id: 'characters',
                    title: 'Characters',
                    body: [
                        'Each role of the kind is a row with an Add button. Press it and pick the character: a ready-made one from a preset, or a model file with its texture. Its model and texture are loaded for you.',
                        'A role can ask for a skeleton, and a character on another skeleton is refused. Roles marked optional can stay empty.',
                        'Use the buttons on a row to show or hide the character, change who it is, give it another model of the same skeleton (your keyframes stay), or remove it.',
                    ],
                    target: '#panel_strut_scene',
                    placement: 'right',
                },
                {
                    id: 'viewport',
                    title: 'Posing and standing',
                    body: [
                        'Click a character in the viewport to pick the bone you clicked, as in any animation. Rotate and move it, and key it.',
                        'Where a character stands is its own move and turn: select its group (the one with an @ in the Outliner) and move or turn it. That position is built into its clips when you export, so in the game every character plays at the scene\'s origin.',
                    ],
                    target: '#preview',
                    placement: 'left',
                },
                {
                    id: 'clips',
                    title: 'Clips',
                    body: [
                        'The Clips section lists what the kind of scene needs. Each row says what is missing, with a red mark for what is required.',
                        'The plus button makes the next clip of that phase with the right name, loop mode and a length in range, and writes its phase, variant and side into the layout for you. In a free scene you name the clips yourself.',
                        'Every character plays the clip of the same name from its own file, so key all of them in every clip.',
                    ],
                    target: '#panel_strut_scene',
                    placement: 'right',
                },
                {
                    id: 'animations',
                    title: 'The clip list',
                    body: ['Clips are the animations in this list. Select one to animate it. Animation, Animation Properties changes its length and loop mode, which a kind of scene may check.'],
                    target: '#panel_animations',
                    placement: 'right',
                },
                {
                    id: 'timeline',
                    title: 'The timeline',
                    body: [
                        'The timeline shows the bones you have selected, grouped by character: each character has a heading and a coloured band. Click a heading to fold that character\'s rows away or open them again.',
                        'Everything you know from Blockbench works: keyframes, the graph editor, and the easing Strut adds.',
                    ],
                    target: '#panel_timeline',
                    placement: 'top',
                },
                {
                    id: 'tags',
                    title: 'Tags and timing',
                    body: [
                        'Tools, Strut Scenes: Animation Tags sets a clip\'s phase, variant and side by hand when its kind does not name them, and moves one character\'s keys and events later or earlier than the others (a reaction a moment behind).',
                    ],
                    target: 'text:li:tools',
                    placement: 'bottom',
                },
                {
                    id: 'check',
                    title: 'Check and Export',
                    body: [
                        'Check lists what is wrong. Errors stop an export (a required role with nobody in it, a character on the wrong skeleton, a clip that does not loop as its phase says); warnings are shown with it.',
                        'Export writes each character\'s clips into its own clip set, made for its skeleton, and the scene\'s layout, into the pack folder you choose (a zip in the web version).',
                    ],
                    target: '#panel_strut_scene',
                    placement: 'right',
                },
                {
                    id: 'saving',
                    title: 'Saving',
                    body: ['A scene is saved as an ordinary Blockbench project (File, Save Project): the characters, their textures, the keyframes and the kind of scene all come back when you open it.'],
                },
                {
                    id: 'done',
                    title: 'That is the whole scene',
                    body: [
                        'Add the characters, make the clips, key them, Check, Export.',
                        'To play this again: the ? at the top of the Scene panel, or Help, Strut Scenes Tour. View, Strut Scenes: Show or Hide Variable Placeholders brings back the panel that is hidden in scenes.',
                    ],
                },
            ],
        },
    ];
}
