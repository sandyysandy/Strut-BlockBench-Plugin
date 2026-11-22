# Strut Scenes: making a scene

A **scene** is a few characters playing clips together: two characters in a fight, three at a table, a character and a prop. In Strut Scenes you animate all of them on **one timeline**, and the export separates them: each character gets its own file of clips, and the scene gets a **layout** file that says who takes part and what the clips are.

> **Take the tour.** The **?** at the top of the Scene panel, or Help, **Strut Scenes Tour**, walks through everything on this page on the screen. It can be skipped at any step and played again at any time.

## The words

| Word | What it is |
|---|---|
| **Scene** | One thing the characters do together, with a name (`tango`) and a namespace (`my_mod`). |
| **Role** | A place in the scene (`lead`, `partner`). A role can ask for a skeleton. |
| **Character** | A model with its texture, standing in a role. |
| **Clip** | One animation of the whole scene (`animation.tango.intro`). Every character plays the clip of this name **from its own file**. |
| **Phase** | A kind of clip a scene has: an intro, a slow part, an ending. A clip's *phase*, *variant* and *side* tell the game what it is. |
| **Kind of scene** (template) | What roles a scene has and which clips, with the rules for naming and timing them. See below. |
| **Skeleton ID** | The rig a character is built on. A role made for a skeleton takes only characters on it. |

## Start a scene

**File, New, Strut Scenes.** A dialog asks three things:

1. **Kind of scene.** A free scene has no rules. A kind a mod or tool provides (a scene on a bed, a fight) lists its roles and clips and checks your work against them. Choose the one that matches what you are making. You can change it later in Scene Settings.
2. **Scene**: its name. It names the layout file and the folder of clips.
3. **Namespace**: your mod's id.

A scene opens in **Animate mode** with the **Scene** panel on the left. A scene has no Edit mode: there is no model to change, only characters to pose.

## The Scene panel

From the top:

* The scene's name, its kind and namespace. **?** plays the tour, the **gear** opens Scene Settings (kind, name, namespace).
* **Characters**: one row for each role of the kind, with an **Add** button until the role has a character. A role marked *optional* may stay empty; *(lead)* is the scene's lead role.
* **Clips**: one row for each phase of the kind, and the clips you have made.
* **Nothing missing** or **N things still to do**, and **Check** and **Export**.

## Add the characters

Press **Add** on a role. If preset folders are registered (a tool that knows your game registers them), choose a ready-made character: its model, texture, role and skeleton ID are loaded in one step, and only characters that fit the role are offered. Otherwise choose a **model file**: pick the `.strutmodel`, then its texture images (matched to the model's textures by name), and the character is loaded for you.

* A role that names a skeleton refuses a character on another skeleton and says why.
* **Another from a preset / Another from files** add a character the kind has no role for.
* On a character's row: **eye** shows or hides it in the viewport (its keyframes are still exported), **pencil** changes who it is (skeleton, optional, lead, camera bone) or removes it, **arrows** give it another model of the same skeleton (every keyframe stays).

Each character is a group named `@role` in the Outliner holding the model's bones. Do not rename it.

### Where a character stands

Select the `@role` group and **move and turn it** with the usual gizmo. That is where the character stands in the scene. When you export, the position is built into the character's clips, so in the game every character plays at the scene's origin. Turn it about the vertical axis only.

## Make the clips

* **In a scene of a kind**, the Clips section lists the phases. A phase row says what is missing (*no clip yet*, *variant 2 has no R clip*, *longer than 10s*). The **plus** button makes the next clip of that phase, **named, looped and sized as the kind says**, and its phase, variant and side are written into the layout for you. A red mark means the phase is required.
* **In a free scene**, press **Add a clip** and name it.

Select a clip in the Animations list to animate it. **Animation, Animation Properties** changes its length and loop mode (a kind may require a loop mode and a range of lengths).

**Key every character in every clip.** Each plays its own file, and one with no keys in a clip stands at rest while the others move.

## Animate

* **Click a character in the viewport** to pick the bone you clicked, as in any animation. Or pick it in the Outliner.
* The **timeline** shows the bones you have selected, **grouped by character**: each character has a heading and a coloured band, and **a click on the heading folds** the character's rows away or opens them again. Two characters' bones with the same name are told apart.
* Keyframes, the graph editor and the easings Strut adds all work as usual.
* **Tools, Strut Scenes: Animation Tags** sets a clip's phase, variant and side by hand (in a scene of a kind that names them this is already done), and a **shift in time** for each character: its keys and events move later or earlier than the others' (a reaction a moment behind).
* Sounds, particles and events on the timeline belong to the scene's first character in this version.

## Check and export

**Check** lists what is wrong. **Errors stop an export**: a required role with nobody in it, a character on the wrong skeleton, a required phase with no clip, a clip that does not loop as its phase says, a length out of range, a character with no skeleton ID. **Warnings** are shown with the export: a clip that is no phase of the kind, a character with no keys in a clip.

**Export Strut Scene** (File, Export) asks for the pack folder (a zip in the web version) and writes:

```
assets/<skeleton namespace>/strut/animations/scenes/<scene>/<role>/skeletons/<skeleton>.strutanim   one for each character
assets/<namespace>/strut/scenes/<scene>.strutscene                                                  the layout
```

Each character's file holds every clip of the scene for that character, made for its skeleton, so it plays on every model with that skeleton. The layout lists the roles (their clip sets, skeletons, which are required, the lead, the camera bone) and every clip's length, loop mode, phase, variant and side.

## Save and reopen

A scene is saved as an ordinary Blockbench project (**File, Save Project**). The characters, their textures, the keyframes and the kind of scene all come back when you open it, even on a machine without the plugin that provided the kind.

## Other things in the menus

* **Tools, Strut Scenes: Add Clip / Edit Character / Check the Scene / Character Preset Folders** do what the Scene panel's buttons do.
* **View, Strut Scenes: Show or Hide Variable Placeholders.** That panel is hidden in a scene, which has no use for it.

## For tool and mod authors

Kinds of scene, ready-made characters and the `StrutScenes` API are described in [STRUT_SCENES_API.md](STRUT_SCENES_API.md).

## Troubleshooting

| You see | It means |
|---|---|
| *the role X has no character yet* | A required role is empty. Press Add on it. |
| *X must be on the skeleton a:b, not c:d* | The character's model has another Skeleton ID. Fix it in the model's project and export it again, or pick another character. |
| *Y: no clip yet* | The kind requires a clip of that phase. Press its plus button. |
| *Y should be looping* | A clip of the phase has the wrong loop mode. Animation, Animation Properties. |
| *the scene has no name / no namespace* | Open Scene Settings (the gear). |
| A character does nothing in a clip | It has no keys in it. Key it, or accept that it stands at rest. |
| I cannot click a character's bones | Make sure you are in Animate mode. Scenes made with an early build had their geometry locked; opening the scene unlocks it. |
