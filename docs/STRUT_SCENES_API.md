# Strut Scenes: templates, presets and the API

Strut Scenes is the Toolkit's project type for making a scene (or the clips of one skeleton) for several characters on one timeline. A scene has **roles** (who takes part) and **clips** (what they play). The Toolkit knows nothing about any one game's kinds of scene. A **scene template** says what a kind of scene is, so the person making one is told what is missing instead of having to know it, and the export is checked against it. Templates and ready-made characters (**presets**) are data: a mod, a pack tool or another Blockbench plugin adds them.

Everything here is neutral: the Toolkit ships two built-in templates (a free scene, and clips for one skeleton) and nothing else. A game's own scene kinds belong in the tool or plugin that knows the game.

## Ways to add templates

1. **From a Blockbench plugin, in code:** `globalThis.StrutScenes` (below).
2. **From a folder**, for a tool that is not a Blockbench plugin (a pack editor): a folder holding a `templates.json`, registered by writing its path into the browser storage of Blockbench:
   `localStorage['strut_scene_template_folders']` is a JSON list of folder paths, for example `["C:/packs/mymod/scenes"]`. The folders are read when a scene is started, when Scene Settings is opened and when Blockbench starts.
3. **Character presets** work the same way: `localStorage['strut_actor_preset_folders']` lists folders that each hold a `presets.json` (see the end).

## The template file

```json
{
  "version": 1,
  "templates": [
    {
      "id": "mymod:duet",
      "name": "A duet",
      "group": "My Mod",
      "description": "Two characters on a stage",
      "roles": [
        { "id": "lead", "name": "Lead", "description": "The one who leads", "skeleton": "mymod:human", "compatible": ["mymod:robot"],
          "required": true, "lead": true, "camera": "eye", "presetGroup": "People" },
        { "id": "second", "name": "Second", "required": false }
      ],
      "clips": {
        "naming": "animation.{scene}.{phase}",
        "phases": [
          { "id": "intro", "name": "Intro", "description": "How it starts", "loop": "loop", "required": true, "seconds": { "min": 1, "max": 10 } },
          { "id": "slow", "name": "Slow", "loop": "loop", "variants": { "min": 1, "max": 3 }, "sides": ["L", "R"] },
          { "id": "end", "name": "End", "loop": "once" }
        ],
        "freeClips": false
      },
      "rules": { "keyedRoles": ["lead"] }
    }
  ]
}
```

### Roles

| key | meaning |
|---|---|
| `id` | The role's name in the scene and in the clip set folder (`a-z 0-9 _ . / -`). Unique in the template. |
| `name`, `description` | What the person is shown. |
| `skeleton`, `compatible` | The skeleton id a character in the role must be on, and others it also takes. Empty: any. A character on another skeleton is an error. |
| `required` | Default true. The scene cannot be exported with the role empty. |
| `lead`, `camera` | Written to the scene layout (the lead role, the bone a player in the role looks out of). |
| `presetGroup` | The heading of the presets to offer for this role, when it names no skeleton. |

### Clips

* `naming` is the form of a clip's name. `{scene}` and `{phase}` are put in. A side adds `_<side>` and a variant above 1 adds `_<n>`, so the phase `slow` of the scene `tango` is `animation.tango.slow`, its second variant `animation.tango.slow_2`, the right side of its third `animation.tango.slow_R_3`. Tell the person (and the game) what a clip is **from the template, never by parsing names**: the Toolkit writes each clip's `phase`, `variant` and `side` into the scene layout.
* Each **phase**:

| key | meaning |
|---|---|
| `id`, `name`, `description` | `id` is what the layout's `phase` says (`a-z 0-9 _`). |
| `loop` | `once`, `loop` or `hold`: every clip of the phase has it. A clip that does not is an error. `any`: the loop mode is not checked (a new clip is made looping), for a game that does not insist on one. |
| `required` | The scene must have a clip of this phase. |
| `variants` | `{ "min", "max" }`: how many variants there may be, counting from 1. A phase that asks for a minimum of 1 or more is required. Default: none needed, one allowed. |
| `sides` | Names of the sides a clip of the phase comes in (`["L", "R"]`). Every variant then needs one clip for each side. |
| `sidesOptional` | `true`: a variant may be one plain clip with no side instead of the sided ones (but not both). Adding a clip then offers "no side" first. |
| `sidesRequired` | With sides, the ones a sided variant must have all of (default: all of `sides`); the others may be there or not. |
| `seconds` | `{ "min", "max" }`: how long a clip of the phase may be. `max` 0 is no limit. |

* `freeClips`: whether a clip that is no phase of the template is allowed (a warning if not). A template with no phases is a free one.

### Rules

`keyedRoles`: roles that must have keys in every clip (a warning when one has none).

What the template makes of a scene: the **Scene** panel lists the roles (each with an Add button until it has a character) and the phases (each with what is missing, and a button that makes the next clip of the phase with the right name, loop mode and a length in range). Errors stop an export; warnings are shown with it.

## The JavaScript API

`globalThis.StrutScenes` exists while the Toolkit is loaded. Plugins should check for it and for `apiVersion`.

```js
StrutScenes.apiVersion                 // 1
StrutScenes.registerTemplate(template | [templates], source = 'api')
                                       // adds them (the shape above); returns { ok, problems: [..] }.
                                       // A source that registers an id again replaces its own; it never takes over an id another source has,
                                       // and a built-in id is never taken.
StrutScenes.unregisterTemplates(source)
StrutScenes.templates()                // [{ id, name, group, source }]
StrutScenes.registerPresetFolder(path)
StrutScenes.registerTemplateFolder(path)   // returns a promise: the folder is read
StrutScenes.onTemplatesChanged(callback)   // returns a function that stops listening
```

A scene keeps a copy of the template it was made with, so it opens (and exports) on a machine that does not have the plugin that registered it.

## Character presets

A folder with a `presets.json` holds ready-made characters, so adding one is one choice instead of a model, then images, then typing a skeleton id:

```json
{ "version": 1, "name": "My Mod",
  "presets": [ { "id": "ava", "name": "Ava", "group": "People", "role": "lead", "skeleton": "mymod:human",
                 "model": "models/ava.strutmodel", "textures": ["textures/ava.png"], "compatible": [], "camera": "" } ] }
```

Paths are relative to the folder (a path that climbs out of it is refused). For a role of a scene only the presets that can fill it are offered: those on the role's skeleton (or one it also takes), else those under its `presetGroup`.
