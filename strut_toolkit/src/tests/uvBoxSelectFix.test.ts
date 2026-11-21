/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadUvBoxSelectFix, unloadUvBoxSelectFix } from '../ts/uvBoxSelectFix';

/**
 * The UV box selection fix against stand-ins for Blockbench's UV editor: with only a mesh selected the pointer handler is told there are no box UVs while it
 * starts a box selection, and with a cube selected, or nothing, it runs as it did; unloading puts the handler back
 */
describe('UV box selection with a mesh selected', () => {
  const scope = globalThis as any;
  let seen: boolean[];
  let originalHandler: (...args: any[]) => any;
  let realIsBoxUV: () => boolean;

  beforeEach(() => {
    seen = [];
    realIsBoxUV = () => true;
    originalHandler = jest.fn(function () {
      seen.push(scope.UVEditor.isBoxUV());

      return 'handled';
    });
    scope.UVEditor = {isBoxUV: realIsBoxUV, vue: {onPointerDown: originalHandler}};
    scope.Mesh = {selected: []};
    scope.Cube = {selected: []};
  });

  afterEach(() => {
    unloadUvBoxSelectFix();
    delete scope.UVEditor;
    delete scope.Mesh;
    delete scope.Cube;
  });

  test('a mesh selected with no cube: the handler is told there are no box UVs, and gets the real answer back afterwards', () => {
    scope.Mesh.selected = [{}];
    loadUvBoxSelectFix();

    expect(scope.UVEditor.vue.onPointerDown('event')).toBe('handled');
    expect(seen).toEqual([false]);
    expect(scope.UVEditor.isBoxUV).toBe(realIsBoxUV);
    expect(originalHandler).toHaveBeenCalledWith('event');
  });

  test('the real answer is put back even when the handler throws', () => {
    scope.Mesh.selected = [{}];
    scope.UVEditor.vue.onPointerDown = () => {
      throw new Error('boom');
    };
    loadUvBoxSelectFix();

    expect(() => scope.UVEditor.vue.onPointerDown()).toThrow('boom');
    expect(scope.UVEditor.isBoxUV).toBe(realIsBoxUV);
  });

  test('a cube selected, with or without a mesh: the handler runs as it did', () => {
    scope.Cube.selected = [{}];
    loadUvBoxSelectFix();
    scope.UVEditor.vue.onPointerDown();

    scope.Mesh.selected = [{}];
    scope.UVEditor.vue.onPointerDown();

    expect(seen).toEqual([true, true]);
  });

  test('nothing selected: the handler runs as it did', () => {
    loadUvBoxSelectFix();
    scope.UVEditor.vue.onPointerDown();

    expect(seen).toEqual([true]);
  });

  test('unloading puts the handler back, unless something else has wrapped it since', () => {
    loadUvBoxSelectFix();
    expect(scope.UVEditor.vue.onPointerDown).not.toBe(originalHandler);

    unloadUvBoxSelectFix();
    expect(scope.UVEditor.vue.onPointerDown).toBe(originalHandler);

    loadUvBoxSelectFix();

    const theirs = () => 'theirs';

    scope.UVEditor.vue.onPointerDown = theirs;
    unloadUvBoxSelectFix();
    expect(scope.UVEditor.vue.onPointerDown).toBe(theirs);
  });

  test('loading twice wraps once, and loading without a UV editor does nothing and does not throw', () => {
    loadUvBoxSelectFix();

    const wrapper = scope.UVEditor.vue.onPointerDown;

    loadUvBoxSelectFix();
    expect(scope.UVEditor.vue.onPointerDown).toBe(wrapper);

    unloadUvBoxSelectFix();
    delete scope.UVEditor;

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => loadUvBoxSelectFix()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
