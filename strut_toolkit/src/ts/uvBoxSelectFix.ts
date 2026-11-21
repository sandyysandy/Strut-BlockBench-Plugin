/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Box selecting UVs of a mesh in Blockbench 5.x.
 *
 * Select a mesh and drag a box over its UVs in the UV editor, and cubes that are not selected, and are not even in the way of what you are doing, are selected
 * as well, whenever their UV box happens to lie under the rectangle. With a cube selected it does not happen.
 *
 * Why: the UV editor's pointer handler ({@code UVEditor.vue.onPointerDown}) starts a box selection by asking {@code UVEditor.isBoxUV()} whether it is working with
 * box UVs. With a cube selected the answer comes from the selected cubes; with only a mesh selected there are none to ask, so the answer is the project's
 * {@code box_uv} setting, which is on in a box UV project. The box selection then goes through every cube of the project (not only the selected elements) and
 * selects each cube whose UV box overlaps the rectangle, which is how box UV cubes are picked by their UVs, and is wrong when what is being edited is a mesh.
 *
 * What this does: while the handler starts a box selection and a mesh is selected with no cube, the editor is told it is not working with box UVs, which is true:
 * a mesh has face UVs. The box selection then works on the selected elements only, as it does for any other face UV element. Nothing else changes: with a cube
 * selected, or nothing selected, the handler runs exactly as it did.
 */

interface Patched {
  vue: any;
  original: any;
  wrapper: any;
}

let patched: Patched | null = null;

/** Whether the selection is a mesh and no cube: what is being edited has face UVs, so there are no box UVs to be selecting by */
function onlyMeshesSelected(): boolean {
  const scope = globalThis as any;

  return (scope.Mesh?.selected?.length ?? 0) > 0 && (scope.Cube?.selected?.length ?? 0) === 0;
}

export function loadUvBoxSelectFix(): void {
  if (patched)
    return;

  const editor: any = (globalThis as any).UVEditor;
  const vue = editor?.vue;

  if (!vue || typeof vue.onPointerDown !== 'function' || typeof editor.isBoxUV !== 'function') {
    console.warn('[Strut Toolkit] The UV editor was not found, so the box selection fix was not installed.');

    return;
  }

  const original = vue.onPointerDown;
  const wrapper = function (this: any, ...args: any[]): any {
    if (!onlyMeshesSelected())
      return original.apply(this, args);

    const isBoxUV = editor.isBoxUV;

    editor.isBoxUV = () => false;

    try {
      // the handler reads it as the box selection begins, before anything is dragged
      return original.apply(this, args);
    }
    finally {
      editor.isBoxUV = isBoxUV;
    }
  };

  vue.onPointerDown = wrapper;
  patched = {vue, original, wrapper};
}

export function unloadUvBoxSelectFix(): void {
  if (!patched)
    return;

  // only if nothing else has wrapped it since: another plugin's wrapper is not ours to remove
  if (patched.vue.onPointerDown === patched.wrapper)
    patched.vue.onPointerDown = patched.original;

  patched = null;
}
