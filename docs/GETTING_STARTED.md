# Getting started with the Strut Toolkit

The Strut Toolkit is a Blockbench plugin for **Strut**, a mod library that animates and simulates models in Minecraft: Java Edition mods. The Toolkit is where those models and their animations are made. It writes the files the game reads.

> **A guided tour is built in.** Help, **Strut Toolkit Tour** and Help, **Strut Scenes Tour** walk you through the screen. You are offered each once, the first time you open a project of that kind. Either can be skipped at any step (Skip tour, or Escape) and played again at any time from the Help menu.

## What you can make

| You want | You make | Read |
|---|---|---|
| One character, block or item with bones, cubes, meshes, physics and animations | A **Strut Animated Model** | This page |
| A scene that several characters play together | A **Strut Scenes** project | [STRUT_SCENES.md](STRUT_SCENES.md) |
| Armour that fits a character | A model made on the character's skeleton, exported as a slot | Armour, below |

## A model

1. **File, New, Strut Animated Model.** Give it a name, a Mod ID (your mod's namespace), and what it is for: entity, block, item, armour or object.
2. Model as usual. The groups in the Outliner are the bones. Cubes, free-form meshes and armatures with skin weights are all supported.
3. Set the **Skeleton ID** in File, Project, for example `my_mod:humanoid`. See below.
4. Animate in Animate mode.
5. **File, Export, Export Strut Model (Binary)** writes a `.strutmodel`. **Export Strut Animations (Binary)** writes a `.strutanim`.
6. Put the files in your mod's assets (or a pack folder). The mod's documentation says where.

An older Bedrock `.geo.json` model or animation can be opened and converted.

### The skeleton ID

A skeleton ID names a rig: `my_mod:humanoid`, `my_mod:quadruped`. Every model built on the same rig has the same ID. It is stored in the model and in every animation exported from it.

* An animation exported for a skeleton plays on **every** model with that skeleton. You make a walk once and every model with the rig walks.
* A scene only lets a character fill a role that was made for its skeleton, so the game never plays a clip on a body it was not made for.
* Leave it empty for a model that is not used in scenes and shares nothing with other models.

The ID is `namespace:path`, lower case.

### Animating

* **Easings**: every Blockbench interpolation plus more than thirty easings (some take an argument), bezier, step and smooth keyframes.
* **Molang expressions** in keyframes.
* **Markers and event instructions** on the timeline, which a mod's event bindings can react to (a sound, a particle, a name the mod listens for).
* The Keyframe panel shows the easing of the selected keyframes.

### Physics

Choose the **Physics** mode (beside Edit, Paint and Animate). Pick a bone in the panel's list and make it a **Spring**, a **Chain**, or, if it has a mesh, **Cloth** or **Flesh**. A look sets sensible numbers; the sliders refine them. **Simulate** moves the real model through a scripted motion, or one of its animations, with the same solvers as the game, and draws the colliders and the simulated cloth and flesh over it. **Collision shapes** shows and fits the shapes a bone gets. Everything is undoable and saved with the model. Tools, **Physics as JSON (advanced)** shows the same data as text.

### Armour

Armour is its own model, made **on top of a character's skeleton**: the same bone names and pivots, with only the pieces that are worn kept.

1. Select the groups that hold the armour of one slot and set **Armour slot** on them (head, chest, legs, feet, body).
2. **File, Export, Export Armour Slot Model (Binary)** exports just those groups, on top of the bones above them, so the piece is worn by bone name.
3. A bone of the armour that sits on a bone of the character with **flesh** moves with that flesh. A plate that only lies over the flesh bends with it. The mod's documentation says how a wearer profile and an armour set are written.

## Strut Scenes in one minute

A **scene** is a few characters playing clips together: you animate all of them on one timeline, and the export splits it into one file of clips for each character plus a layout that says who takes part. Start one with **File, New, Strut Scenes**, and read [STRUT_SCENES.md](STRUT_SCENES.md), or take the tour.

## If something is wrong

* **Nothing in File, Export.** The export actions only appear in a Strut Animated Model project, and Export Strut Scene in a Strut Scenes project.
* **A character is refused with "is on the skeleton ...".** The model's Skeleton ID is not the one the role asks for. Open the model's project and fix its Skeleton ID, then export it again.
* **An animation plays on the wrong bones in the game.** Its skeleton ID or bone names do not match the model's. Strut warns in the game log when an animation was authored against a different skeleton.
* **The tour covers a part of the screen.** Press Escape to skip it.
