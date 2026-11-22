# Animation workspace: animate skeletons and whole scenes, not one model

Status: **plan, not started** (2026-11-21). Engine side: Strut `docs-internal/MULTI_ACTOR_SCENE_PLAN.md`. This plan is the Blockbench toolkit's part and
is meant to be built by the plugin's own session. Formats are ours to change: the plugin, Strut and the pack tool are all ours.

## 0a. Strut Scenes (2026-11-27)

The workspace is called **Strut Scenes** wherever the person sees it (format name, menus, panel, messages); ids in code and files keep `workspace`/`strut_workspace` so saved projects open. New: **scene templates** (`sceneTemplate.ts`, pure and tested: roles with skeleton and requirements, phases with loop mode, length, variants and sides, a naming form, the checks `checkAgainstTemplate` and the per-phase `phaseStatus`), a **registry and public API** (`templateRegistry.ts`: `globalThis.StrutScenes`, folders listed in `localStorage['strut_scene_template_folders']`, two built-in free templates), the **Scene panel** (`scenePanel.ts`: role slots with Add, phase rows that make the next clip with one press, Check and Export), and the **new scene dialog** that asks the kind. The kind's whole template is kept in the scene's project data. A clip's phase, variant and side are worked out from the template and written to the layout. Game specific kinds (on a bed, on a player) are not in the plugin: the tool that knows the game registers them. Documented for tool and plugin authors in `docs/STRUT_SCENES_API.md`. Checked live in Blockbench 5.2.2 with a template registered through the API: new scene, Add on a role, one-press clips for phases with sides, Check, Export, a missing required role stopping the export.

## 0. Decision (2026-11-26): the workspace is a project type of its own

The workspace is not a model project with actors added. It is its own Blockbench format, **Strut Workspace** (`strut_workspace`, `src/ts/stage/workspaceFormat.ts`): Animate mode only (`edit_mode`, `paint_mode` and `display_mode` are off), no model of its own, no model tools. The toolkit loads the actors' models and textures itself (Add actor takes a `.strutmodel` and its images, matched by name, `textureMatch.ts`), keeps them in the project, and the Actors panel (`actorsPanel.ts`) lists, shows, hides, edits, swaps and removes them, so the person animating only animates. It is saved as a normal Blockbench project (the format keeps actors, textures and keyframes; checked: save, reopen, same actors, textures, keys with easing, hidden state). A dedicated `.strutstage` file is not needed for that and is not written.

## 1. Why

Today an animation is made **inside a model project**: the clip is keyed to that model's groups, and exported into a `.strutanim` that carries that
model's exact skeleton fingerprint. That makes three things impossible or awkward:

- **Animating for a skeleton**, not a model: a clip that every model with one skeleton id plays is made on one of them and hoped to fit the others.
- **Animating several characters together**: a scene with two participants has been made by putting the second participant's whole rig inside every
  model of the first, so the second never has a model of its own.
- **Seeing a scene on everyone it will be played with**: there is no way to swap who is being animated without starting again.

## 2. What it is

A second kind of Blockbench project, a **workspace** (`.strutstage`), next to the model projects:

- It has **no geometry of its own**. It holds **actors** and **animations**.
- An **actor** is a slot: a role name (`host`, `partner`, `third`, `prop_1`, `camera`), the **skeleton id** it is animated for, and a **preview model**
  (any model with that id), which can be swapped at any time without losing a keyframe.
- An **animation** is one clip of the whole workspace: keyframes on the bones of every actor, on one timeline. Its name is the clip name every actor
  is exported under.
- A workspace with **one actor** is how a skeleton-level clip is made (walk, idle, a gesture for every model with one skeleton id). A workspace with several
  is a scene. Same tool, same files, same export.

Only **export** separates the actors: each actor's tracks become that actor's clip, in a file for its skeleton id.

## 3. Skeleton ids

A skeleton is **one string on the model**, its **skeleton id** (`pleasurehorizons:jenny`). Nothing else: no skeleton file, no bone matching.

- A model project has a **Skeleton ID** field in its properties, saved in the `.strutmodel` header.
- An animation file is written with the skeleton id it was made for.
- A workspace actor names a skeleton id; its preview model must have that id (the model picker lists only those), and swapping to another model with the
  same id is free.
- The id is the author's promise that the rigs are the same. The toolkit checks only that the id matches.

This is what lets a clip be animated once and played by every model with the same id, and what lets a scene role say who may fill it.

## 4. The workspace in Blockbench

### 4a. How actors live in the project

Blockbench's timeline, graph editor, keyframe tools and gizmos animate **groups of the current project**. To keep every one of those tools, an actor
is loaded as a **top-level group** `@<role>` holding the preview model's bones (its geometry is not locked: a locked element cannot be clicked in the viewport, and a bone is picked by clicking its geometry; a scene has no edit mode to change it in):

- Geometry is reference only: not selectable as elements, never exported as a model, drawn with the preview model's textures.
- Bones of two actors may share names (two actors with one skeleton id); every operation is scoped to one actor's subtree.
- **Animation data is stored by actor and bone name, never by group UUID**, in the workspace file. When an actor is (re)loaded or swapped, the plugin
  rebuilds Blockbench's animators for the new groups from the stored tracks. This is what makes swapping free and what keeps the file independent of
  any one model.
- A bone that another model of the same id has and the preview model lacks cannot be keyed here; the preview model is chosen to have the bones the
  animation needs.

### 4b. Panels

- **Actors**: add (role, skeleton id, preview model), swap model, show/hide, solo, lock, colour tag in the outliner and timeline, remove.
- **Stage**: each actor's place. The actor root is moved and turned with the normal gizmo; this is its stage offset (§5b).
- The timeline shows one row group per actor, collapsible, so a scene with three characters stays readable.

### 4c. Animating

- Everything Blockbench does already: keyframes, interpolation and easing (the toolkit's easing set), graph editor, onion skinning, loop modes.
- **Per-actor offsets in time**: an actor's tracks can be shifted against the others inside one animation (a reaction a few frames late) and exported
  shifted.
- **Copy an actor's motion** to another actor with the same skeleton id (mirrored or not).
- **Markers**: a workspace marker belongs to the scene; a marker on an actor's track belongs to that actor. Events (sounds, particles, typed events)
  are authored per actor as today.
- **Props and cameras**: a prop is an actor with a model and its own skeleton id (one root bone); a camera actor is a locator with a field of view
  track, exported as a clip on its own role so a mod can follow it.

### 4d. Checks (live, in a problems list, and again on export)

- An animation's length and loop mode are one for every actor (it is one clip on one clock in game).
- Every actor's preview model has the actor's skeleton id.
- Every actor has a skeleton id (a role with none cannot be checked by a scene).

## 5. Export

### 5a. Files

For each animation and each actor, one clip named after the animation, written into that actor's **clip set** (Strut's `CLIP_SETS_PLAN.md`):
`strut/animations/scenes/<scene>/<role>/skeletons/<skeleton path>.strutanim` when the file is for the **skeleton** (every model with that id plays it), or
`.../<role>/characters/<character path>.strutanim` when the file is for one **character** (a model). That is chosen at export time. For a character the export offers
**changed clips only**: it compares each clip with the skeleton's file and writes only the ones that differ, under the same names, so the model's file stays
a sparse override. Export also writes the **layout** (`<scene>.strutscene`, JSON): roles with their clip sets and skeleton ids (and `compatible` ids the
author lists), required or optional, camera bone per role, each clip's phase, length and loop mode (the phase and variant read once from the clip's
name here, so the game need not).

Export one actor, one animation, or all. Export straight into a pack folder (the pack tool opens workspaces and exports through the same code).

### 5b. Stage space and the root

In game every role stands at the scene origin and plays its clip there; where it stands on the stage is part of its clip. So on export each actor's
**stage offset (position and turn) is folded into its root bone's channels**, and its rest root stays at the model's own origin (so the same model walks
about normally outside scenes). The fold is a rigid transform applied to every root key; rotation keys are composed, not added.

### 5c. Format additions (binary `.strutanim` and `.strutmodel`)

- Animation header: the skeleton id string, and a per-clip **role** string (informational; lets one file be checked
  against a layout).
- Model header: the skeleton id string.
- Both are additive (a new version or an extension section, as the physics section is), and old files still load.

## 6. Importing

- **Open a `.strutanim` with its model** as a one-actor workspace.
- **Split actor**: open a model project whose model holds a second character as its own root, pick that root; the workspace gets two actors (the root
  becomes `@partner`, the rest `@host`) and every animation's keyframes are divided by subtree. Exact, because the second character was its own root.
  The pack tool runs the same split in bulk (its own plan); the plugin's is for one scene at a time and for checking the result by eye.
- **Convert a model project's animations** to a workspace (clip by clip, keyed by bone name), asking for the skeleton id if the model has none.

## 7. Order

| Stage | What |
|---|---|
| 1 | Skeleton id field on model projects; the format fields of §5c in the codecs and their tests |
| 2 | Workspace format: actors as locked groups, tracks stored by actor and bone name, swap rebuilding animators, save and open |
| 3 | Export: per actor clips into clip sets (skeleton or character, changed clips only), root fold, layout file; golden tests (a two-actor workspace exported equals hand-made files) |
| 4 | Panels: Actors, Stage; timeline grouped by actor; problems list |
| 5 | Import: one-actor from a `.strutanim`, split actor, convert a model project |
| 6 | Time offsets, copy and mirror between actors, props and camera actors |

**Built so far (2026-11-25):** stages 1 to 3 and the start of 4, checked in a real Blockbench 5.2.2 (the web build with the plugin loaded from a local server: a script tag, after registering a `Plugin('strut_toolkit')` object so `BBPlugin.register` runs `onload`). A workspace is an open Strut project whose top level groups `@<role>` are actors (`src/ts/stage/stageProject.ts`): the preview model is loaded under the group by `buildProjectFromModel(model, into)` with its geometry locked, the data Blockbench has no place for is one JSON project property (`strut_stage`: scene, namespace, each actor's skeleton, who may fill the role, the pivots the model was loaded with, each animation's phase, variant, side and per actor shifts), and `readStage()` reads the project back as the plain `Stage`. The actor's stage offset is its group's own move and turn (gizmo, edit mode): a point x ends at `O + Ry(x + d - O)`, with `O` the group's pivot and `d` how far its bones' pivots moved. `stageFormat.ts` (the `.strutstage` JSON shape, parse, the checks), `stageFold.ts` (the offset folded into every root bone's keys), `stageExport.ts` (a file per actor in its clip set by skeleton or owner, time shifts, the layout with `phase`/`variant`/`side` tags) are pure and tested. `stageUi.ts` holds the menu actions (Workspace: Add Actor, Edit Actor, Settings, Animation Tags, Check; File, Export, Export Workspace: a folder in the app, one zip on the web). **Verified live:** the key space is the editor's (rotation and position keys are applied as they are, rotation order ZYX, in every format); with an actor moved and turned by the gizmo, the exported clip played on the unmoved model puts a probe cube at exactly the positions the editor shows. **Not built:** a `.strutstage` file written and opened (a workspace is saved as the project, which keeps the actors, their keyframes and the property; swapping an actor's preview model and rebuilding its animators is not built), a dedicated Actors panel and a timeline grouped by actor, 'changed clips only' for a model owner, import (one actor from a `.strutanim`, split actor, convert a model project), time offsets drawn on the timeline, copy and mirror between actors, props and camera actors, real textures on the preview models. Events are given to the first actor (Blockbench keeps one effects list per animation).

Stages 1 to 3 are enough for a person to make a two-character scene by hand; 4 makes it pleasant; 5 brings existing work in.

## 8. Risks and things to measure

- **Several full models in one project**: measure Blockbench with three 200-bone models and their textures; actors can be hidden, and a lighter proxy
  draw (bones only) is the fallback.
- **Blockbench animators keyed by UUID**: the rebuild on swap is the one piece that fights Blockbench; it gets its own tests (swap twice, undo, redo).
- **Undo across a swap**: a swap is one undo step that restores the old model and animators together.
- **Clips edited in a model project after the move**: a model project still exports as today; the workspace is not required for single-model work.

## Talking to the other sessions (the Agent Bridge)

The Strut session (the engine), the game mod's session, the Pack Creator's session (`pc`) and the Blockbench toolkit's session (`plugin`) cannot see each other. They
talk through a shared mailbox folder that lives outside every repository, so nothing in it is committed: `Documents/Idea Projects/Agent Bridge/`. **Read its
`README.md` once**, then work like this:

- **You are the `plugin` session.** Write only in `Agent Bridge/plugin/`. Read `strut/`, the game mod's folder (the README lists it) and the other tool's folder before each unit of work, and after a
  build failure that might come from another repo. Never edit or delete a file another session wrote; to answer, write a new file.
- **A message is one file**, `NNN-plugin-to-<who>-<slug>.md` (`NNN` the next three-digit number in your own folder, from 001), starting with the header the README
  gives (`From`, `To`, `Type` question | request | answer | decision-needed | fyi | done, `Re`, `Status`, `Date`), then a short summary and the detail. Never rewrite
  an old message; a correction is a new one.
- **Keep a `STATUS.md`** in your folder and overwrite it freely: *Now*, *Blocked on*, *Last commit*.
- **Who to ask**: an engine API, a format change or a bug in Strut, or a new jar: `strut`. How the game reads a file or what a scene means: the game mod's session. A pack to be converted, checked or shown in the pack tool: `pc`.
  A choice only Sandy can make: a `decision-needed` message addressed `To: sandy`; do not build on either option until he has answered.
- **The formats are shared** by `strut` (reads them), `plugin` (writes them) and `pc` (reads, writes and checks them). The byte layout is written down in the Strut
  repository, `docs-internal/MULTI_ACTOR_SCENE_PLAN.md` section 4. A change to a format is proposed in the bridge by `strut` and answered by the other two before
  anyone builds it; if a byte there does not match what your code does, say so first.
- **This repository is public**: nothing in it, including in messages you copy into its docs, names the game mod, its characters, or anything explicit. Write neutrally here, as the rest of this repository does.
- **What does not go through the bridge**: secrets, tokens, personal data, and anything that belongs in a repo's own docs (put it there and link it).

**Open for you now:** `strut/062-strut-to-pc-and-plugin-formats-ready.md`: the Strut end of skeleton ids, clip sets, event bindings by layers and scene layouts is built and the formats are written down byte for byte. **Stage 1 of this plan** (the Skeleton ID field on model projects and its write into the `.strutmodel` and `.strutanim`) can start now. Answer with a short `plugin/001-plugin-to-strut-...` saying you have read it and where you are starting.
