import { STRUT_WORKSPACE_ID } from '../constants';

/**
 * The Strut Scenes project type: where a scene is animated
 * <p>
 * A project of this type has no model of its own and no modelling tools: no edit mode (nothing to move, add or reshape), no paint mode, no display settings. It holds
 * the actors of a scene (their models and textures are loaded for it, see {@code stageProject.ts}) and the animations, so the person animating only animates.
 * Everything that animates still works as in a model project: the timeline, the graph editor, the toolkit's easing, onion skinning. It is saved as a Blockbench
 * project, which keeps the actors, their textures and every keyframe
 */
export const workspaceFormat = new ModelFormat(STRUT_WORKSPACE_ID, {
    name: 'Strut Scenes',
    category: 'minecraft',
    description: "Make a scene, or the clips of one skeleton, for several characters on one timeline. The characters are loaded for you, the kind of scene says what clips it needs, and each character is exported for Strut by itself",
    icon: 'groups',
    show_on_start_screen: true,
    // the actors are made of bones, cubes and meshes loaded from their models, never edited here
    bone_rig: true,
    meshes: true,
    armature_rig: true,
    per_texture_uv_size: true,
    centered_grid: true,
    animated_textures: true,
    locators: true,
    rotate_cubes: true,
    box_uv: false,
    codec: Codecs.project,
    // animate only
    animation_mode: true,
    edit_mode: false,
    paint_mode: false,
    display_mode: false,
} as any);
